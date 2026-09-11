const axios = require("axios");
const { Spiel, Verein, SrQualifikation, Hall } = require("../models");
const hallRepository = require('../repositories/hallRepository');
const { Op } = require("sequelize");
const { getCoordinates } = require("../utils/coordinates");
const { fieldFn } = require("../utils/licenseUtils");
const {
  GeocodingService,
  getAddressKey,
  isValidCoordinates,
} = require("./geocodingService");

// Konfigurierbare Verbands-ID (Fallback auf Standardwert 3)
const VERBAND_ID = parseInt(process.env.TEAM_SL_VERBAND_ID || "3", 10);
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_DETAIL_CONCURRENCY = 8;
const DEFAULT_DETAIL_PAUSE_MS = 250;
const DEFAULT_GEOCODING_CONCURRENCY = 3;
const EMPTY_SNAPSHOT_CONFIRMATIONS = 2;

const parsePositiveInteger = (value, fallback) => {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
};

const parseNonNegativeInteger = (value, fallback) => {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isInteger(parsedValue) && parsedValue >= 0
    ? parsedValue
    : fallback;
};

const mapWithConcurrency = async (items, mapper, concurrency) => {
  const results = [];
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
};

class TeamSLService {
  constructor() {
    this.baseURL = "https://www.basketball-bund.net";
    this.sessionCookie = null;
    this.client = null;
    this.publicClient = axios.create({
      baseURL: `${this.baseURL}/rest`,
      timeout: parsePositiveInteger(
        process.env.TEAM_SL_PUBLIC_TIMEOUT_MS,
        DEFAULT_REQUEST_TIMEOUT_MS
      ),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    this.detailConcurrency = parsePositiveInteger(
      process.env.TEAM_SL_DETAIL_CONCURRENCY,
      DEFAULT_DETAIL_CONCURRENCY
    );
    this.detailPauseMs = parseNonNegativeInteger(
      process.env.TEAM_SL_DETAIL_PAUSE_MS,
      DEFAULT_DETAIL_PAUSE_MS
    );
    this.geocodingService = new GeocodingService({ repository: Hall ? require('../repositories/geocodingRepository') : null });
    this.geocodingConcurrency = parsePositiveInteger(
      process.env.GEOCODING_CONCURRENCY,
      DEFAULT_GEOCODING_CONCURRENCY
    );
    this.syncRetryAttempts = parsePositiveInteger(
      process.env.TEAM_SL_SYNC_RETRY_ATTEMPTS,
      3
    );
    this.syncRetryDelayMs = parseNonNegativeInteger(
      process.env.TEAM_SL_SYNC_RETRY_DELAY_MS,
      3000
    );
    this.consecutiveEmptyAllSnapshots = 0;
  }

  extractApiData(responseData) {
    if (
      responseData &&
      typeof responseData === "object" &&
      Object.prototype.hasOwnProperty.call(responseData, "data")
    ) {
      return responseData.data;
    }

    return responseData;
  }

  async requestPublicApi({ method, url, data, params }) {
    const response = await this.publicClient.request({
      method,
      url,
      data,
      params,
    });
    const responseData = this.extractApiData(response.data);

    if (!responseData || typeof responseData !== "object") {
      throw new Error(`Ungültige Antwort von BBN für ${method} ${url}`);
    }

    return responseData;
  }

  getTeamSLCredentials() {
    const username = process.env.TEAM_SL_USERNAME;
    const password = process.env.TEAM_SL_PASSWORD;

    if (!username || !password) {
      throw new Error(
        "TEAM_SL_USERNAME und TEAM_SL_PASSWORD müssen in den Umgebungsvariablen gesetzt sein"
      );
    }

    return { username, password };
  }

  async ensureAuthenticated() {
    if (this.client) return;

    const { username, password } = this.getTeamSLCredentials();
    await this.login(username, password);
  }

  async login(username, password) {
    try {
      const loginUrl = `${this.baseURL}/login.do?reqCode=login`;
      const body = new URLSearchParams({ username, password }).toString();

      const res = await axios.post(loginUrl, body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      if (
        typeof res.data === "string" &&
        res.data.includes(
          "Die Kombination aus Benutzername und Passwort ist nicht bekannt!"
        )
      ) {
        throw new Error("Invalid username or password");
      }

      const setCookies = res.headers["set-cookie"];
      this.sessionCookie = this.pickSessionCookie(setCookies);

      if (!this.sessionCookie) {
        throw new Error("No session cookie received");
      }

      this.client = axios.create({
        baseURL: this.baseURL,
        timeout: parsePositiveInteger(
          process.env.TEAM_SL_DETAIL_TIMEOUT_MS,
          DEFAULT_REQUEST_TIMEOUT_MS
        ),
        headers: {
          Cookie: this.sessionCookie,
          Accept: "application/json, text/plain, */*",
        },
      });

      await this.verifyLogin();

      console.log("Erfolgreich bei BBN eingeloggt");
      return true;
    } catch (error) {
      console.error("Login fehlgeschlagen:", error.message);
      throw error;
    }
  }

  pickSessionCookie(setCookieHeaders) {
    if (!setCookieHeaders) return undefined;
    const arr = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : [String(setCookieHeaders)];
    for (const raw of arr) {
      const kv = raw.split(";")[0].trim();
      if (kv.startsWith("SESSION=")) return kv;
    }
    return undefined;
  }

  async verifyLogin() {
    try {
      const userCtx = await this.client.get("/rest/user/lc");
      const userData = this.extractApiData(userCtx.data);
      if (!userData || !userData.loginName) {
        throw new Error(
          "Login did not persist, /rest/user/lc has no loginName"
        );
      }
      return userData;
    } catch (error) {
      console.error("Login-Verifikation fehlgeschlagen:", error.message);
      throw error;
    }
  }

  buildSearchPayload({ date = null, pageFrom = 0, pageSize = 100, zeitraum = "all" } = {}) {
    if (!date) {
      const datum = new Date();
      datum.setHours(0, 0, 0, 0);
      date = datum.toISOString();
    }
    return {
      srName: null,
      ligaKurz: null,
      spielStatus: "ALLE",
      vereinsDelegation: "AUSSCHLIESSLICH",
      vereinsSpiele: "STANDARD",
      datum: date,
      zeitraum,
      sortBy: "sp.spieldatum",
      sortOrder: "asc",
      ats: null,
      pageFrom,
      pageSize,
    };
  }

  async fetchOpenGames(pageFrom = 0, pageSize = 100, zeitraum = "all") {
    try {
      if (!this.client) {
        throw new Error("Nicht eingeloggt. Bitte zuerst login() aufrufen.");
      }

      const payload = this.buildSearchPayload({
        pageFrom: pageFrom,
        pageSize: pageSize,
        zeitraum: zeitraum,
      });
      const result = await this.client.post(
        "/rest/offenespiele/search",
        payload
      );

      const expectedResults = pageSize;
      const actualResults = result.data.results?.length || 0;
      console.log(
        `Seite ${Math.floor(pageFrom / pageSize) + 1}: geplant ${expectedResults}, erhalten ${actualResults} Spiele`
      );
      return result.data;
    } catch (error) {
      console.error("Fehler beim Abrufen der offenen Spiele:", error.message);
      throw error;
    }
  }

  async fetchAllOpenGames(pageSize = 100, zeitraum = "all") {
    try {
      console.log("Starte neue Abfrage-Strategie mit matchId-basierter Methode...");

      // 1. Alle Ligen abrufen
      console.log("Lade alle Ligen...");
      const ligen = await this.fetchAllLigen();
      console.log(`${ligen.length} Ligen gefunden`);

      if (ligen.length === 0) {
        throw new Error("BBN hat keine Ligen geliefert");
      }

      // 2. Alle Matches aus allen Ligen abrufen und nach zeitraum filtern
      console.log(`Lade alle Matches aus allen Ligen und filtere nach zeitraum: ${zeitraum}...`);
      const allMatches = [];
      const failedLeagues = [];
      
      for (const liga of ligen) {
        try {
          console.log(`Lade Matches für Liga ${liga.ligaId}: ${liga.liganame}`);
          const matches = await this.fetchMatchesForLiga(liga);
          
          // Filtere Matches nach zeitraum basierend auf kickoffDate
          const filteredMatches = this.filterMatchesByZeitraum(matches, zeitraum);
          allMatches.push(...filteredMatches);
          
          console.log(`  ${matches.length} Matches gefunden, ${filteredMatches.length} nach Zeitraum-Filter`);
        } catch (error) {
          console.error(`Fehler beim Laden der Matches für Liga ${liga.ligaId}:`, error.message);
          failedLeagues.push({
            ligaId: liga.ligaId,
            ligaName: liga.liganame,
            error: error.message,
          });
        }
      }

      if (failedLeagues.length > 0) {
        const failedLeagueNames = failedLeagues
          .map((league) => `${league.ligaId} (${league.ligaName || "unbekannt"})`)
          .join(", ");
        throw new Error(
          `Unvollständiger BBN-Abruf: ${failedLeagues.length}/${ligen.length} Ligen konnten nicht geladen werden (${failedLeagueNames})`
        );
      }

      console.log(`Gesamt ${allMatches.length} Matches gefunden`);

      // Doppelte Match-IDs würden unnötige Requests erzeugen und die
      // Vollständigkeitsprüfung verfälschen.
      const uniqueMatchesById = new Map();
      for (const match of allMatches) {
        if (!match || match.matchId === undefined || match.matchId === null) {
          throw new Error("BBN hat ein Match ohne matchId geliefert");
        }
        uniqueMatchesById.set(String(match.matchId), match);
      }

      const uniqueMatches = [...uniqueMatchesById.values()];
      console.log(
        `Gesamt ${uniqueMatches.length} eindeutige Matches nach Duplikatprüfung`
      );

      // 3. Für jede matchId detaillierte Daten abrufen. Die Parallelität ist
      // bewusst begrenzt, damit BBN nicht mit hunderten Requests gleichzeitig
      // belastet wird und die Synchronisierung nicht unvollständig endet.
      await this.ensureAuthenticated();
      const batchSize = this.detailConcurrency;
      console.log(
        `Lade detaillierte Daten für ${uniqueMatches.length} Matches mit maximal ${batchSize} parallelen Requests...`
      );
      const detailedGames = [];
      const detailFailures = [];
      const totalBatches = Math.ceil(uniqueMatches.length / batchSize);

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, uniqueMatches.length);
        const batch = uniqueMatches.slice(batchStart, batchEnd);

        console.log(
          `Verarbeite Batch ${batchIndex + 1}/${totalBatches}: Matches ${batchStart + 1}-${batchEnd}`
        );

        const batchPromises = batch.map(async (match, index) => {
          const globalIndex = batchStart + index;
          try {
            console.log(
              `  Lade Details für Match ${globalIndex + 1}/${uniqueMatches.length}: ${match.matchId}`
            );
            
            const gameDetails = await this.fetchGameDetails(match.matchId);
            if (!gameDetails) {
              return {
                success: false,
                matchId: match.matchId,
                error: "Keine Details erhalten",
              };
            }

            const convertedGame = this.convertGameDetailsToApiFormat(gameDetails);
            if (!convertedGame) {
              return {
                success: false,
                matchId: match.matchId,
                error: "Details konnten nicht konvertiert werden",
              };
            }

            return { success: true, game: convertedGame, matchId: match.matchId };
          } catch (error) {
            console.error(
              `  Fehler beim Laden der Details für Match ${match.matchId}:`,
              error.message
            );
            return {
              success: false,
              matchId: match.matchId,
              error: error.message,
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        let successCount = 0;
        batchResults.forEach((result) => {
          if (result.success) {
            detailedGames.push(result.game);
            successCount++;
            return;
          }
          detailFailures.push(result);
        });

        console.log(
          `  Batch ${batchIndex + 1} abgeschlossen: ${successCount}/${batch.length} erfolgreich`
        );

        if (batchIndex < totalBatches - 1 && this.detailPauseMs > 0) {
          console.log(`  Warte ${this.detailPauseMs}ms vor nächstem Batch...`);
          await new Promise((resolve) => setTimeout(resolve, this.detailPauseMs));
        }
      }

      console.log(`\n=== Abfrage abgeschlossen ===`);
      console.log(`Geladene Spiele: ${detailedGames.length}/${uniqueMatches.length}`);

      if (detailFailures.length > 0) {
        const failedMatchIds = detailFailures
          .slice(0, 10)
          .map((failure) => failure.matchId)
          .join(", ");
        const suffix = detailFailures.length > 10 ? " ..." : "";
        throw new Error(
          `Unvollständiger BBN-Abruf: ${detailFailures.length}/${uniqueMatches.length} Spieldetails fehlgeschlagen (IDs: ${failedMatchIds}${suffix})`
        );
      }

      return {
        total: detailedGames.length,
        results: detailedGames,
        pages: 1,
        pageSize: detailedGames.length,
        actualCount: detailedGames.length,
        complete: true,
        apiReportedTotal: uniqueMatches.length,
        sourceLeagueCount: ligen.length,
        sourceMatchCount: uniqueMatches.length,
        detailFailures: [],
      };
    } catch (error) {
      console.error("Fehler beim Abrufen aller offenen Spiele:", error.message);
      throw error;
    }
  }

  async fetchAllLigen(index = 0) {
    let currentIndex = parsePositiveInteger(index, 0);
    const allLigen = [];
    const seenLigaIds = new Set();

    while (true) {
      const response = await this.requestPublicApi({
        method: "post",
        url: "/wam/liga/list",
        data: {
          akgGeschlechtIds: [],
          altersklasseIds: [],
          gebietIds: [],
          ligatypIds: [],
          sortBy: 0,
          spielklasseIds: [],
          token: "",
          verbandIds: [VERBAND_ID],
        },
        params: { startAtIndex: currentIndex },
      });

      if (!Array.isArray(response.ligen)) {
        throw new Error(
          `Ungültige Liga-Antwort von BBN bei startAtIndex=${currentIndex}`
        );
      }

      const pageLigen = response.ligen.filter((liga) => liga.verbandId !== 30);
      pageLigen.forEach((liga) => {
        if (liga.ligaId === undefined || liga.ligaId === null) {
          throw new Error("BBN hat eine Liga ohne ligaId geliefert");
        }

        const ligaKey = String(liga.ligaId);
        if (!seenLigaIds.has(ligaKey)) {
          seenLigaIds.add(ligaKey);
          allLigen.push(liga);
        }
      });

      console.log(
        `${pageLigen.length} Ligen bei Index ${currentIndex} gefunden`
      );

      if (!response.hasMoreData) break;

      const pageSize = Number(response.size);
      if (!Number.isInteger(pageSize) || pageSize <= 0) {
        throw new Error(
          `BBN liefert hasMoreData ohne gültige Seitengröße bei startAtIndex=${currentIndex}`
        );
      }

      const nextIndex = currentIndex + pageSize;
      if (nextIndex <= currentIndex) {
        throw new Error("Ungültige BBN-Liga-Paginierung erkannt");
      }
      currentIndex = nextIndex;
    }

    if (allLigen.length === 0) {
      throw new Error("BBN hat keine Ligen für den konfigurierten Verband geliefert");
    }

    return allLigen;
  }

  async fetchMatchesForLiga(liga) {
    const data = await this.requestPublicApi({
      method: "get",
      url: `/competition/spielplan/id/${encodeURIComponent(liga.ligaId)}`,
    });

    if (!Array.isArray(data.matches)) {
      throw new Error(
        `Ungültige Spielplan-Antwort von BBN für Liga ${liga.ligaId}`
      );
    }

    return data.matches;
  }

  async fetchGameDetails(matchId) {
    try {
      if (!this.client) {
        throw new Error("Nicht eingeloggt. Bitte zuerst login() aufrufen.");
      }

      const response = await this.client.get(`/rest/assignschiri/getGame/${matchId}`);
      return this.extractApiData(response.data);
    } catch (error) {
      console.error(`Fehler beim Laden der Game-Details für Match ${matchId}:`, error.message);
      throw error;
    }
  }

  parseMatchDate(value) {
    if (value === undefined || value === null || value === "") return null;

    if (typeof value === "number" || /^\d+$/.test(String(value))) {
      const numericValue = Number(value);
      const milliseconds = numericValue < 100000000000
        ? numericValue * 1000
        : numericValue;
      const timestampDate = new Date(milliseconds);
      return Number.isNaN(timestampDate.getTime()) ? null : timestampDate;
    }

    const dateString = String(value).trim();
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }

    const parsedDate = new Date(dateString);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  filterMatchesByZeitraum(matches, zeitraum) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Immer nur zukünftige Spiele (ab heute) - nie gestern oder früher
    const startDate = new Date(today);
    
    let endDate;
    
    if (zeitraum === "all") {
      // Bei "all" nur zukünftige Spiele, aber ohne Enddatum
      endDate = null;
    } else {
      switch (zeitraum) {
        case "w1":
          // Nächste 8 Tage
          endDate = new Date(today);
          endDate.setDate(today.getDate() + 8);
          break;
          
        case "w3":
          // 3 Wochen + 1 Tag = 22 Tage
          endDate = new Date(today);
          endDate.setDate(today.getDate() + 22);
          break;
         
        default:
          console.warn(`Unbekannter zeitraum: ${zeitraum}, verwende 'all'`);
          endDate = null;
      }
    }

    if (endDate) {
      console.log(`  Filtere Matches zwischen ${startDate.toISOString().split('T')[0]} und ${endDate.toISOString().split('T')[0]} (nur zukünftige Spiele)`);
    } else {
      console.log(`  Filtere Matches ab ${startDate.toISOString().split('T')[0]} (nur zukünftige Spiele, kein Enddatum)`);
    }

    return matches.filter(match => {
      if (!match.kickoffDate) {
        return false;
      }

      const matchDate = this.parseMatchDate(match.kickoffDate);
      if (!matchDate) {
        return false;
      }
      const matchDateOnly = new Date(matchDate.getFullYear(), matchDate.getMonth(), matchDate.getDate());
      
      // Immer nur zukünftige Spiele (ab heute)
      if (matchDateOnly < startDate) {
        return false;
      }
      
      // Wenn Enddatum gesetzt ist, auch das prüfen
      if (endDate && matchDateOnly > endDate) {
        return false;
      }
      
      return true;
    });
  }

  convertGameDetailsToApiFormat(gameDetails) {
    try {
      const game1 = gameDetails.game1;
      if (!game1) return null;

      // Konvertiere zu dem Format, das die alte API verwendet
      return {
        sp: {
          spielplanId: game1.spielplanId,
          spieldatum: game1.spieldatum,
          heimMannschaftLiga: game1.heimMannschaftLiga ? {
            mannschaftName: game1.heimMannschaftLiga.mannschaftName || 'N/A',
            hideLink: game1.heimMannschaftLiga.hideLink || false
          } : {
            mannschaftName: 'N/A',
            hideLink: false
          },
          gastMannschaftLiga: game1.gastMannschaftLiga ? {
            mannschaftName: game1.gastMannschaftLiga.mannschaftName || 'N/A',
            hideLink: game1.gastMannschaftLiga.hideLink || false
          } : {
            mannschaftName: 'N/A',
            hideLink: false
          },
          liga: {
            liganame: game1.liga?.liganame || 'N/A',
            srQualifikation: game1.liga?.srQualifikation
          },
          spielfeld: {
            id: game1.spielfeld?.spielfeldId ?? game1.spielfeld?.id ?? null,
            latitude: game1.spielfeld?.latitude ?? game1.spielfeld?.lat ?? null,
            longitude: game1.spielfeld?.longitude ?? game1.spielfeld?.lng ?? null,
            bezeichnung: game1.spielfeld?.bezeichnung || 'N/A',
            strasse: game1.spielfeld?.strasse || '',
            plz: game1.spielfeld?.plz || '',
            ort: game1.spielfeld?.ort || ''
          },
          sr1Verein: game1.sr1Verein,
          sr2Verein: game1.sr2Verein,
          sr3Verein: game1.sr3Verein
        },
        sr1OffenAngeboten: (gameDetails.sr1?.offenAngeboten || false) && !gameDetails.sr1?.lizenzNr,
        sr2OffenAngeboten: (gameDetails.sr2?.offenAngeboten || false) && !gameDetails.sr2?.lizenzNr,
        sr3OffenAngeboten: (gameDetails.sr3?.offenAngeboten || false) && !gameDetails.sr3?.lizenzNr,
        sr1: gameDetails.sr1?.spielleitung ? {
          spielleitung: gameDetails.sr1.spielleitung,
          lizenzNr: gameDetails.sr1.lizenzNr,
          srVerein: gameDetails.sr1.srVerein
        } : null,
        sr2: gameDetails.sr2?.spielleitung ? {
          spielleitung: gameDetails.sr2.spielleitung,
          lizenzNr: gameDetails.sr2.lizenzNr,
          srVerein: gameDetails.sr2.srVerein
        } : null,
        sr3: gameDetails.sr3?.spielleitung ? {
          spielleitung: gameDetails.sr3.spielleitung,
          lizenzNr: gameDetails.sr3.lizenzNr,
          srVerein: gameDetails.sr3.srVerein
        } : null
      };
    } catch (error) {
      console.error("Fehler beim Konvertieren der Game-Details:", error.message);
      return null;
    }
  }

  async isLoggedIn() {
    try {
      if (!this.client) return false;
      await this.verifyLogin();
      return true;
    } catch (error) {
      return false;
    }
  }

  async logout() {
    this.sessionCookie = null;
    this.client = null;
    console.log("Von BBN abgemeldet");
  }

  async executeCronJob(zeitraum = "all") {
    const startTime = new Date();
    console.log(`BBN Cronjob gestartet um ${startTime.toISOString()}`);

    try {
      const { username, password } = this.getTeamSLCredentials();
      let lastError = null;

      for (let attempt = 1; attempt <= this.syncRetryAttempts; attempt++) {
        try {
          console.log(
            `Starte Synchronisierungsversuch ${attempt}/${this.syncRetryAttempts}`
          );
          await this.login(username, password);
          const games = await this.fetchAllOpenGames(100, zeitraum);

          if (!games.complete) {
            throw new Error("BBN-Abruf ist nicht vollständig");
          }

          console.log(
            `Cronjob erfolgreich abgeschlossen. ${games.total} Spiele abgerufen.`
          );

          return {
            success: true,
            gamesCount: games.total,
            timestamp: startTime.toISOString(),
            data: games,
          };
        } catch (error) {
          lastError = error;
          console.error(
            `Synchronisierungsversuch ${attempt}/${this.syncRetryAttempts} fehlgeschlagen:`,
            error.message
          );
          await this.logout();

          if (attempt < this.syncRetryAttempts && this.syncRetryDelayMs > 0) {
            const delay = this.syncRetryDelayMs * 2 ** (attempt - 1);
            console.log(`Warte ${delay}ms vor dem nächsten Versuch...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      return {
        success: false,
        error: lastError?.message || "BBN-Synchronisierung fehlgeschlagen",
        timestamp: startTime.toISOString(),
      };
    } catch (error) {
      console.error("Cronjob fehlgeschlagen:", error.message);

      return {
        success: false,
        error: error.message,
        timestamp: startTime.toISOString(),
      };
    } finally {
      await this.logout();
    }
  }

  async processGamesData(zeitraum = "all") {
    try {
      const result = await this.executeCronJob(zeitraum);

      if (result.success) {
        console.log(`Verarbeite ${result.gamesCount} Spiele...`);

        const sourceMatchCount = result.data?.apiReportedTotal;
        if (!Number.isInteger(sourceMatchCount) || sourceMatchCount < 0) {
          throw new Error("BBN-Synchronisierung enthält keine gültige Match-Anzahl");
        }

        if (sourceMatchCount > 0) {
          this.consecutiveEmptyAllSnapshots = 0;
        }

        let allowEmptySnapshot = false;
        if (zeitraum === "all" && sourceMatchCount === 0) {
          this.consecutiveEmptyAllSnapshots++;

          if (
            this.consecutiveEmptyAllSnapshots < EMPTY_SNAPSHOT_CONFIRMATIONS
          ) {
            console.warn(
              `Leerer vollständiger BBN-Snapshot (${this.consecutiveEmptyAllSnapshots}/${EMPTY_SNAPSHOT_CONFIRMATIONS}). Bestehende Spiele bleiben unverändert.`
            );

            return {
              ...result,
              databaseResult: {
                success: true,
                skipped: true,
                reason: "empty_snapshot_not_confirmed",
                consecutiveEmptySnapshots: this.consecutiveEmptyAllSnapshots,
              },
            };
          }

          allowEmptySnapshot = true;
          this.consecutiveEmptyAllSnapshots = 0;
          console.warn(
            "Leerer BBN-Snapshot wurde zweimal vollständig bestätigt; entferne veraltete Spiele."
          );
        }

        // Spieldaten in die Datenbank speichern
        const dbResult = await this.saveGamesToDatabase(
          result.data.results,
          zeitraum,
          {
            sourceComplete: result.data.complete === true,
            allowEmptySnapshot,
          }
        );

        console.log("Spieldaten erfolgreich in der Datenbank gespeichert");

        return {
          ...result,
          databaseResult: dbResult,
        };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error("Fehler bei der Spieldatenverarbeitung:", error.message);
      throw error;
    }
  }

  async getBBNHealth() {
    try {
      const result = await this.processGamesData();
      return result;
    } catch (error) {
      throw error;
    }
  }

  async validateGameProcessing(gamesData) {
    try {
      const totalGames = gamesData.length;
      const processedGames = await Spiel.count({
        where: {
          spielplanId: {
            [Op.in]: gamesData.map(game => game.sp.spielplanId)
          }
        }
      });
      
      const openGames = await Spiel.count({
        where: {
          [Op.or]: [
            { sr1OffenAngeboten: true },
            { sr2OffenAngeboten: true },
            { sr3OffenAngeboten: true }
          ]
        }
      });

      return {
        totalGamesFromAPI: totalGames,
        gamesInDatabase: processedGames,
        openGamesInDatabase: openGames,
        processingComplete: processedGames === totalGames,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Fehler bei der Validierung der Spielverarbeitung:", error.message);
      throw error;
    }
  }



  async orphanRemoval(gamesData, transaction, { allowEmpty = false } = {}) {
    const gameIds = gamesData.map((game) => game.sp.spielplanId);

    if (gameIds.length === 0 && !allowEmpty) {
      throw new Error(
        "Orphan-Removal abgebrochen: ein leerer Snapshot darf keine Spiele löschen"
      );
    }

    const where = gameIds.length > 0
      ? {
          spielplanId: {
            [Op.notIn]: gameIds,
          },
        }
      : {};

    const result = await Spiel.destroy({
      where,
      force: true,
      transaction,
    });

    console.log(`✓ ${result} veraltete Spiele entfernt`);
    return result;
  }

  getGameVenueAddress(gameData) {
    const venue = gameData?.sp?.spielfeld || {};
    return {
      street: venue.strasse || "",
      postalCode: venue.plz || "",
      city: venue.ort || "",
    };
  }

  isGameOffered(gameData) {
    return [
      [gameData?.sr1OffenAngeboten, gameData?.sr1?.lizenzNr],
      [gameData?.sr2OffenAngeboten, gameData?.sr2?.lizenzNr],
      [gameData?.sr3OffenAngeboten, gameData?.sr3?.lizenzNr],
    ].some(([offered, licenseNumber]) => offered && !licenseNumber);
  }

  getVenueCoordinates(venue = {}) {
    const latitude = (
      venue.latitude
        ?? venue.lat
        ?? venue.breitengrad
    );
    const longitude = (
      venue.longitude
        ?? venue.lng
        ?? venue.lon
        ?? venue.laengengrad
    );

    return getCoordinates(latitude, longitude);
  }

  async getStoredVenueCoordinates(addresses) {
    if (!addresses.length || typeof Spiel.findAll !== "function") {
      return new Map();
    }

    try {
      const rows = await Spiel.findAll({
        attributes: [
          "spielStrasse",
          "spielPlz",
          "spielOrt",
          "spielLatitude",
          "spielLongitude",
        ],
        where: {
          [Op.or]: addresses.map((address) => ({
            spielStrasse: address.street,
            spielPlz: address.postalCode,
            spielOrt: address.city,
          })),
        },
        raw: true,
      });
      const coordinatesByAddress = new Map();

      const history = await hallRepository.coordinatesForAddresses(addresses);
      for (const hall of history) {
        const coordinates = getCoordinates(hall.latitude, hall.longitude);
        if (coordinates) coordinatesByAddress.set(getAddressKey(hall), coordinates);
      }

      for (const row of rows || []) {
        const coordinates = getCoordinates(row.spielLatitude, row.spielLongitude);
        if (!isValidCoordinates(coordinates)) continue;

        const addressKey = getAddressKey({
          street: row.spielStrasse,
          postalCode: row.spielPlz,
          city: row.spielOrt,
        });
        if (addressKey) coordinatesByAddress.set(addressKey, coordinates);
      }

      return coordinatesByAddress;
    } catch (error) {
      console.warn(
        `Gespeicherte Hallenkoordinaten konnten nicht gelesen werden: ${error.message}`
      );
      return new Map();
    }
  }

  async resolveVenueCoordinates(gamesData) {
    const venuesByKey = new Map();

    for (const gameData of gamesData) {
      if (!this.isGameOffered(gameData)) continue;

      const address = this.getGameVenueAddress(gameData);
      const key = getAddressKey(address);
      if (!key) continue;

      const sourceCoordinates = this.getVenueCoordinates(gameData.sp.spielfeld);
      const currentVenue = venuesByKey.get(key);
      venuesByKey.set(key, {
        address,
        coordinates: sourceCoordinates || currentVenue?.coordinates || null,
      });
    }

    const addressEntries = [...venuesByKey.entries()];
    if (!addressEntries.length) return new Map();

    // In Tests oder bei einem schlanken Mock-Modell keine externen Requests ausführen.
    if (typeof Spiel.findAll !== "function") {
      return new Map(
        addressEntries.map(([key, venue]) => [key, venue.coordinates])
      );
    }

    const storedCoordinates = await this.getStoredVenueCoordinates(
      addressEntries
        .filter(([, venue]) => !venue.coordinates)
        .map(([, venue]) => venue.address)
    );
    const coordinatesByKey = new Map();

    for (const [key, venue] of addressEntries) {
      if (venue.coordinates) {
        coordinatesByKey.set(key, venue.coordinates);
        continue;
      }

      if (storedCoordinates.has(key)) {
        coordinatesByKey.set(key, storedCoordinates.get(key));
      }
    }

    const addressesToGeocode = addressEntries.filter(
      ([key]) => !coordinatesByKey.has(key)
    );
    if (addressesToGeocode.length) {
      console.log(
        `Ermittle Koordinaten für ${addressesToGeocode.length} neue Hallenadresse(n)...`
      );
    }

    const geocodedEntries = await mapWithConcurrency(
      addressesToGeocode,
      async ([key, venue]) => {
        try {
          const coordinates = await this.geocodingService.geocodeAddress(
            venue.address
          );
          return [key, coordinates];
        } catch (error) {
          console.warn(
            `Halle konnte nicht geocodiert werden (${venue.address.city || "ohne Ort"}): ${error.message}`
          );
          return [key, null];
        }
      },
      this.geocodingConcurrency
    );

    return new Map([...coordinatesByKey, ...geocodedEntries]);
  }

  async saveGamesToDatabase(
    gamesData,
    zeitraum,
    { sourceComplete = true, allowEmptySnapshot = false } = {}
  ) {
    if (!Array.isArray(gamesData)) {
      throw new Error("Spieldaten müssen als Array vorliegen");
    }

    if (!sourceComplete) {
      throw new Error(
        "Spieldaten sind nicht vollständig; Datenbank bleibt unverändert"
      );
    }

    if (allowEmptySnapshot && zeitraum !== "all") {
      throw new Error("Leere Snapshots dürfen nur im vollständigen Zeitraum angewendet werden");
    }

    if (gamesData.length === 0 && !allowEmptySnapshot) {
      console.warn(
        `Leerer ${zeitraum}-Snapshot wird nicht gespeichert; bestehende Spiele bleiben unverändert.`
      );
      return {
        savedGames: 0,
        updatedGames: 0,
        skippedGames: 0,
        savedVereine: 0,
        savedSrQualifikationen: 0,
        errors: [],
        skippedReasons: {},
        totalProcessed: 0,
        success: true,
        skipped: true,
        reason: "empty_snapshot",
      };
    }

    const invalidGame = gamesData.find(
      (game) =>
        !game?.sp ||
        game.sp.spielplanId === undefined ||
        game.sp.spielplanId === null
    );
    if (invalidGame) {
      throw new Error(
        "Spieldaten enthalten mindestens ein Spiel ohne spielplanId"
      );
    }

    const venueCoordinatesByKey = await this.resolveVenueCoordinates(gamesData);
    const hallIds = new Map();
    if (Hall) {
      for (const game of gamesData) {
        const venue = game.sp.spielfeld || {};
        const address = this.getGameVenueAddress(game);
        const key = hallRepository.identityKey({ name: venue.bezeichnung, ...address });
        if (hallIds.has(key)) continue;
        const coordinates = venueCoordinatesByKey.get(getAddressKey(address));
        const hall = await hallRepository.rememberVenue({ name: venue.bezeichnung, ...address, teamSlId: venue.id, ...coordinates });
        hallIds.set(key, hall?.id ?? null);
      }
    }
    const transaction = await Spiel.sequelize.transaction();
    try {
      console.log("Starte Transaktion für Spieldaten...");
      console.log(`Verarbeite ${gamesData.length} Spiele...`);

      let savedGames = 0;
      let updatedGames = 0;
      let skippedGames = 0;
      let savedVereine = 0;
      let savedSrQualifikationen = 0;
      let errors = [];
      let skippedReasons = {
        notOffered: 0,
        bothVereinsHideLink: 0,
        heimVereinNotFound: 0,
        gastVereinNotFound: 0,
        offenAngebotenAberVereinNull: 0,
        processingError: 0
      };

      for (const gameData of gamesData) {
        try {
          // Prüfe, ob das Spiel offen angeboten wird
          // Wenn offenAngeboten true ist, aber lizenzNr gesetzt ist, dann ist es nicht mehr offen angeboten
          const sr1OffenAngeboten = gameData.sr1OffenAngeboten && !gameData.sr1?.lizenzNr;
          const sr2OffenAngeboten = gameData.sr2OffenAngeboten && !gameData.sr2?.lizenzNr;
          const sr3OffenAngeboten = gameData.sr3OffenAngeboten && !gameData.sr3?.lizenzNr;
          
          const isOffered = sr1OffenAngeboten || sr2OffenAngeboten || sr3OffenAngeboten;
          
          if (!isOffered) {
            // Spiel wird nicht offen angeboten - aus DB entfernen
            await Spiel.destroy({
              where: {
                spielplanId: {
                  [Op.eq]: gameData.sp.spielplanId,
                },
              },
              force: true,
              transaction,
            });
            skippedReasons.notOffered++;
            skippedGames++;
            continue;
          }

          // Prüfe, ob offen angeboten aber entsprechender Verein null ist
          if (
            (gameData.sr1OffenAngeboten && !gameData.sp.sr1Verein) ||
            (gameData.sr2OffenAngeboten && !gameData.sp.sr2Verein) ||
            (gameData.sr3OffenAngeboten && !gameData.sp.sr3Verein)
          ) {
            console.log(`Spiel ${gameData.sp.spielplanId} übersprungen: offen angeboten aber Verein null`);
            await Spiel.destroy({
              where: {
                spielplanId: {
                  [Op.eq]: gameData.sp.spielplanId,
                },
              },
              force: true,
              transaction,
            });
            skippedReasons.offenAngebotenAberVereinNull++;
            skippedGames++;
            continue;
          }

          // 1. Heim-Verein speichern/aktualisieren
          let heimVerein;
          if (gameData.sp.sr1Verein) {
            const [verein, created] = await Verein.findOrCreate({
              where: { vereinId: gameData.sp.sr1Verein.vereinId },
              defaults: {
                vereinsnummer: gameData.sp.sr1Verein.vereinsnummer,
                vereinsname: gameData.sp.sr1Verein.vereinsname,
                verbandId: gameData.sp.sr1Verein.verbandId,
                kreisId: gameData.sp.sr1Verein.kreisId,
                bezirkId: gameData.sp.sr1Verein.bezirkId,
              },
              transaction,
            });

            if (!created) {
              await verein.update({
                vereinsnummer: gameData.sp.sr1Verein.vereinsnummer,
                vereinsname: gameData.sp.sr1Verein.vereinsname,
                verbandId: gameData.sp.sr1Verein.verbandId,
                kreisId: gameData.sp.sr1Verein.kreisId,
                bezirkId: gameData.sp.sr1Verein.bezirkId,
              }, { transaction });
            }

            heimVerein = verein;
            if (created) savedVereine++;
          }

          // 2. Gast-Verein speichern/aktualisieren
          let gastVerein;
          if (gameData.sp.sr2Verein) {
            const [verein, created] = await Verein.findOrCreate({
              where: { vereinId: gameData.sp.sr2Verein.vereinId },
              defaults: {
                vereinsnummer: gameData.sp.sr2Verein.vereinsnummer,
                vereinsname: gameData.sp.sr2Verein.vereinsname,
                verbandId: gameData.sp.sr2Verein.verbandId,
                kreisId: gameData.sp.sr2Verein.kreisId,
                bezirkId: gameData.sp.sr2Verein.bezirkId,
              },
              transaction,
            });

            if (!created) {
              await verein.update({
                vereinsnummer: gameData.sp.sr2Verein.vereinsnummer,
                vereinsname: gameData.sp.sr2Verein.vereinsname,
                verbandId: gameData.sp.sr2Verein.verbandId,
                kreisId: gameData.sp.sr2Verein.kreisId,
                bezirkId: gameData.sp.sr2Verein.bezirkId,
              }, { transaction });
            }

            gastVerein = verein;
            if (created) savedVereine++;
          }

          if (heimVerein?.hideLink && gastVerein?.hideLink) {
            await Spiel.destroy({
              where: {
                spielplanId: {
                  [Op.eq]: gameData.sp.spielplanId,
                },
              },
              force: true,
              transaction,
            });
            console.log(
              `Spiel ${gameData.sp.spielplanId} wird übersprungen - beide Vereine haben hideLink gesetzt`
            );
            skippedReasons.bothVereinsHideLink++;
            skippedGames++;
            continue;
          }
          if (!heimVerein && gastVerein?.hideLink) {
            await Spiel.destroy({
              where: {
                spielplanId: {
                  [Op.eq]: gameData.sp.spielplanId,
                },
              },
              force: true,
              transaction,
            });
            console.log(
              `Spiel ${gameData.sp.spielplanId} wird übersprungen - Heimverein nicht gefunden`
            );
            skippedReasons.heimVereinNotFound++;
            skippedGames++;
            continue;
          }
          if (!gastVerein && heimVerein?.hideLink) {
            await Spiel.destroy({
              where: {
                spielplanId: {
                  [Op.eq]: gameData.sp.spielplanId,
                },
              },
              force: true,
              transaction,
            });
            console.log(
              `Spiel ${gameData.sp.spielplanId} wird übersprungen - Gastverein nicht gefunden`
            );
            skippedReasons.gastVereinNotFound++;
            skippedGames++;
            continue;
          }

          // 3. SR-Qualifikation speichern/aktualisieren (falls vorhanden)
          let srQualifikationId = null;
          if (gameData.sp.liga && gameData.sp.liga.srQualifikation) {
            const [srQual, created] = await SrQualifikation.findOrCreate({
              where: {
                srQualifikationId:
                  gameData.sp.liga.srQualifikation.srQualifikationId,
              },
              defaults: {
                bezeichnung: gameData.sp.liga.srQualifikation.bezeichnung,
                kurzBezeichnung:
                  gameData.sp.liga.srQualifikation.kurzBezeichnung,
              },
              transaction,
            });

            if (!created) {
              await srQual.update({
                bezeichnung: gameData.sp.liga.srQualifikation.bezeichnung,
                kurzBezeichnung:
                  gameData.sp.liga.srQualifikation.kurzBezeichnung,
              }, { transaction });
            }

            srQualifikationId = srQual.srQualifikationId;
            if (created) savedSrQualifikationen++;
          }

          // 4. SR-Lizenz berechnen
          const ligaName = gameData.sp.liga?.liganame || "";
          const srLizenz = fieldFn({ liganame: ligaName });
          const venueAddress = this.getGameVenueAddress(gameData);
          const gameVenueCoordinates = venueCoordinatesByKey.get(
            getAddressKey(venueAddress)
          ) || null;

          // 5. Spiel speichern/aktualisieren
          const [spiel, created] = await Spiel.findOrCreate({
            where: { spielplanId: gameData.sp.spielplanId },
            defaults: {
              hallId: hallIds.get(hallRepository.identityKey({ name: gameData.sp.spielfeld?.bezeichnung, ...venueAddress })) ?? null,
              spieldatum: gameData.sp.spieldatum,
              heimVereinId: gameData.sp.sr1Verein?.vereinId || null,
              gastVereinId: gameData.sp.sr2Verein?.vereinId || null,
              heimMannschaftName:
                gameData.sp.heimMannschaftLiga?.mannschaftName || "",
              gastMannschaftName:
                gameData.sp.gastMannschaftLiga?.mannschaftName || "",
              ligaName: ligaName,
              spielfeldName: gameData.sp.spielfeld?.bezeichnung || "",
              spielStrasse: gameData.sp.spielfeld?.strasse || "",
              spielPlz: gameData.sp.spielfeld?.plz || "",
              spielOrt: gameData.sp.spielfeld?.ort || "",
              spielLatitude: gameVenueCoordinates?.latitude ?? null,
              spielLongitude: gameVenueCoordinates?.longitude ?? null,
              srQualifikationId: srQualifikationId,
              srLizenz: srLizenz,
              sr1OffenAngeboten: gameData.sr1OffenAngeboten || false,
              sr2OffenAngeboten: gameData.sr2OffenAngeboten || false,
              sr3OffenAngeboten: gameData.sr3OffenAngeboten || false,
              sr1VereinId: gameData.sp.sr1Verein?.vereinId || null,
              sr2VereinId: gameData.sp.sr2Verein?.vereinId || null,
              sr3VereinId: gameData.sp.sr3Verein?.vereinId || null,
              sr1VereinName: gameData.sp.sr1Verein?.vereinsname || null,
              sr2VereinName: gameData.sp.sr2Verein?.vereinsname || null,
              sr3VereinName: gameData.sp.sr3Verein?.vereinsname || null,
              rawData: gameData,
            },
            transaction,
          });

          if (!created) {
            // Update bestehenden Eintrag
            await spiel.update({
              hallId: hallIds.get(hallRepository.identityKey({ name: gameData.sp.spielfeld?.bezeichnung, ...venueAddress })) ?? null,
              spieldatum: gameData.sp.spieldatum,
              heimVereinId: gameData.sp.sr1Verein?.vereinId || null,
              gastVereinId: gameData.sp.sr2Verein?.vereinId || null,
              heimMannschaftName:
                gameData.sp.heimMannschaftLiga?.mannschaftName || "",
              gastMannschaftName:
                gameData.sp.gastMannschaftLiga?.mannschaftName || "",
              ligaName: ligaName,
              spielfeldName: gameData.sp.spielfeld?.bezeichnung || "",
              spielStrasse: gameData.sp.spielfeld?.strasse || "",
              spielPlz: gameData.sp.spielfeld?.plz || "",
              spielOrt: gameData.sp.spielfeld?.ort || "",
              spielLatitude: gameVenueCoordinates?.latitude ?? null,
              spielLongitude: gameVenueCoordinates?.longitude ?? null,
              srQualifikationId: srQualifikationId,
              srLizenz: srLizenz,
              sr1OffenAngeboten: gameData.sr1OffenAngeboten || false,
              sr2OffenAngeboten: gameData.sr2OffenAngeboten || false,
              sr3OffenAngeboten: gameData.sr3OffenAngeboten || false,
              sr1VereinId: gameData.sp.sr1Verein?.vereinId || null,
              sr2VereinId: gameData.sp.sr2Verein?.vereinId || null,
              sr3VereinId: gameData.sp.sr3Verein?.vereinId || null,
              sr1VereinName: gameData.sp.sr1Verein?.vereinsname || null,
              sr2VereinName: gameData.sp.sr2Verein?.vereinsname || null,
              sr3VereinName: gameData.sp.sr3Verein?.vereinsname || null,
              rawData: gameData,
            }, { transaction });
          }

          if (created) {
            savedGames++;
          } else {
            updatedGames++;
          }
        } catch (error) {
          const processingError = new Error(
            `Fehler beim Speichern von Spiel ${gameData.sp.spielplanId}: ${error.message}`
          );
          processingError.cause = error;
          console.error(
            processingError.message
          );
          throw processingError;
        }
      }

      console.log(`Datenbank-Update abgeschlossen:`);
      console.log(`- ${savedGames} neue Spiele gespeichert`);
      console.log(`- ${updatedGames} Spiele aktualisiert`);
      console.log(`- ${skippedGames} Spiele übersprungen`);
      console.log(`- ${savedVereine} neue Vereine gespeichert`);
      console.log(
        `- ${savedSrQualifikationen} neue SR-Qualifikationen gespeichert`
      );
      
      // Detaillierte Übersicht der übersprungenen Spiele
      console.log(`\n📊 Übersprungene Spiele - Details:`);
      console.log(`- Nicht offen angeboten: ${skippedReasons.notOffered}`);
      console.log(`- Beide Vereine hideLink: ${skippedReasons.bothVereinsHideLink}`);
      console.log(`- Heimverein nicht gefunden: ${skippedReasons.heimVereinNotFound}`);
      console.log(`- Gastverein nicht gefunden: ${skippedReasons.gastVereinNotFound}`);
      console.log(`- Offen angeboten aber Verein null: ${skippedReasons.offenAngebotenAberVereinNull}`);
      console.log(`- Verarbeitungsfehler: ${skippedReasons.processingError}`);
      
      if (errors.length > 0) {
        console.warn(`⚠️  ${errors.length} Fehler aufgetreten:`);
        errors.forEach(err => {
          console.warn(`  - Spiel ${err.spielplanId}: ${err.error}`);
        });
      }

      // Validierung: Prüfe ob alle Spiele verarbeitet wurden
      const expectedGames = gamesData.length;
      const processedGames = savedGames + updatedGames + skippedGames;
      
      if (processedGames !== expectedGames) {
        console.warn(`⚠️  Verarbeitungsmismatch: ${processedGames}/${expectedGames} Spiele verarbeitet`);
      }

      if (zeitraum === "all") {
        await this.orphanRemoval(gamesData, transaction, {
          allowEmpty: allowEmptySnapshot,
        });
      }

      await transaction.commit();

      return {
        savedGames,
        updatedGames,
        skippedGames,
        savedVereine,
        savedSrQualifikationen,
        errors,
        skippedReasons,
        totalProcessed: savedGames + updatedGames + skippedGames,
        success: errors.length === 0
      };
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error(
          "Fehler beim Zurückrollen der Spieldaten-Transaktion:",
          rollbackError.message
        );
      }
      console.error(
        "❌ Spieldaten-Transaktion abgebrochen:",
        error.message
      );
      throw error;
    }
  }
}

module.exports = new TeamSLService();
