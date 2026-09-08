const { literal, Op } = require("sequelize");
const { Spiel, Verein, SrQualifikation } = require("../models");
const parseJsonValue = require("../utils/parseJsonValue");
const { isGameAtRisk, getRefereePresence } = require("../utils/refereeStatus");
const {
  DEFAULT_SORT_FIELD,
  getCoordinates,
  getDateRange,
  getDistanceExpression,
  getDistanceNullsLastExpression,
  getPagination,
  getRadiusKm,
  getSortParameters,
  parseList
} = require("../utils/spielQuery");

function getGameIncludes() {
  return [
    {
      model: Verein,
      as: "heimVerein",
      foreignKey: "heimVereinId",
      attributes: ["vereinId", "vereinsname", "vereinsnummer"]
    },
    {
      model: Verein,
      as: "gastVerein",
      foreignKey: "gastVereinId",
      attributes: ["vereinId", "vereinsname", "vereinsnummer"]
    },
    {
      model: Verein,
      as: "sr1Verein",
      foreignKey: "sr1VereinId",
      attributes: ["vereinId", "vereinsname", "vereinsnummer"]
    },
    {
      model: Verein,
      as: "sr2Verein",
      foreignKey: "sr2VereinId",
      attributes: ["vereinId", "vereinsname", "vereinsnummer"]
    },
    {
      model: Verein,
      as: "sr3Verein",
      foreignKey: "sr3VereinId",
      attributes: ["vereinId", "vereinsname", "vereinsnummer"]
    },
    {
      model: SrQualifikation,
      as: "srQualifikation",
      foreignKey: "srQualifikationId",
      attributes: ["srQualifikationId", "bezeichnung", "kurzBezeichnung"]
    }
  ];
}

function getFilterAttributes() {
  return ["spielfeldName", "ligaName", "srLizenz", "spieldatum", "sr1OffenAngeboten", "sr2OffenAngeboten"];
}

function getRowValue(row, field) {
  return row?.[field] ?? row?.dataValues?.[field];
}

function getSortedUniqueValues(rows, field) {
  return [...new Set(rows.map((row) => getRowValue(row, field)).filter(Boolean))].sort((first, second) => (
    String(first).localeCompare(String(second), "de-DE", {
      numeric: true,
      sensitivity: "base"
    })
  ));
}

function getAvailableFilters(rows) {
  return {
    atRiskCount: rows.filter((row) => isGameAtRisk({
      sr1OffenAngeboten: getRowValue(row, "sr1OffenAngeboten"),
      sr2OffenAngeboten: getRowValue(row, "sr2OffenAngeboten")
    })).length,
    spielfeldName: getSortedUniqueValues(rows, "spielfeldName"),
    ligaName: getSortedUniqueValues(rows, "ligaName"),
    srLizenz: getSortedUniqueValues(rows, "srLizenz"),
    spieldatum: [...new Set(rows.map((row) => getRowValue(row, "spieldatum")).filter(Boolean))]
      .sort((first, second) => Number(first) - Number(second))
  };
}

function addAndCondition(whereClause, condition) {
  whereClause[Op.and] = [...(whereClause[Op.and] || []), condition];
}

function cloneWhereClause(whereClause) {
  const clonedWhereClause = { ...whereClause };
  if (whereClause[Op.and]) clonedWhereClause[Op.and] = [...whereClause[Op.and]];
  return clonedWhereClause;
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function getLegacyDayRange(timestampValue) {
  const timestamp = Number.parseInt(timestampValue, 10);
  if (!Number.isFinite(timestamp)) return null;

  const startOfDay = new Date(timestamp);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(timestamp);
  endOfDay.setHours(23, 59, 59, 999);

  return {
    start: startOfDay.getTime(),
    end: endOfDay.getTime()
  };
}

function getSortOrder(sortBy, sortOrder, distanceExpression) {
  const order = [];

  if (sortBy === DEFAULT_SORT_FIELD) {
    // Default: gleicher Kalendertag, danach Halle als Gruppe, danach Uhrzeit.
    order.push([literal("DATE(FROM_UNIXTIME(spieldatum / 1000))"), sortOrder]);
    order.push(["spielfeldName", "ASC"]);
    order.push([DEFAULT_SORT_FIELD, sortOrder]);
    return order;
  }

  if (sortBy === "distance" && distanceExpression) {
    order.push([literal(getDistanceNullsLastExpression()), "ASC"]);
    order.push([literal(distanceExpression), sortOrder]);
  } else {
    order.push([sortBy, sortOrder]);
  }

  // Jede Sortierung bleibt bei gleicher Priorität zeitlich stabil und sortiert
  // die Halle alphabetisch als letzte deterministische Ebene.
  if (sortBy !== DEFAULT_SORT_FIELD) order.push([DEFAULT_SORT_FIELD, "ASC"]);
  if (sortBy !== "spielfeldName") order.push(["spielfeldName", "ASC"]);

  return order;
}

class SpieleController {
  async getAllSpiele(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        spieldatum,
        date,
        dateFrom,
        dateTo,
        ligaName,
        ligaNames,
        spielfeldName,
        spielfeldNames,
        srLizenz,
        srLizenzen,
        search,
        latitude,
        longitude,
        radiusKm,
        nearbyOnly,
        atRiskOnly,
        sortBy = DEFAULT_SORT_FIELD,
        sortOrder = "ASC"
      } = req.query;
      if (atRiskOnly !== undefined && ![true, false, "true", "false"].includes(atRiskOnly)) {
        return res.status(400).json({
          success: false,
          error: "atRiskOnly muss true oder false sein"
        });
      }
      const { pageNumber, pageSize, offset } = getPagination(page, limit);

      const dateRange = getDateRange({ date, dateFrom, dateTo });
      const coordinates = getCoordinates(latitude, longitude);
      const requestedRadiusKm = getRadiusKm(radiusKm);
      const requestedSort = getSortParameters(sortBy, sortOrder);
      if (nearbyOnly !== undefined && ![true, false, "true", "false"].includes(nearbyOnly)) {
        return res.status(400).json({ success: false, error: "nearbyOnly muss true oder false sein" });
      }
      const nearbyFilterRequested = nearbyOnly === true || nearbyOnly === "true" || radiusKm !== undefined;
      if (
        ((latitude !== undefined || longitude !== undefined || nearbyFilterRequested || requestedSort.sortBy === "distance") && !coordinates)
        || (nearbyFilterRequested && requestedRadiusKm === null)
      ) {
        return res.status(400).json({
          success: false,
          error: "Für die Entfernung sind gültige latitude/longitude und für den Umkreis ein radiusKm größer 0 bis 500 erforderlich"
        });
      }
      const distanceExpression = coordinates ? getDistanceExpression(coordinates) : null;
      const finalSortBy = requestedSort.sortBy === "distance" && !distanceExpression
        ? DEFAULT_SORT_FIELD
        : requestedSort.sortBy;
      const finalSortOrder = requestedSort.sortOrder;
      const whereClause = {};

      if (dateRange?.invalid) {
        addAndCondition(whereClause, literal("1 = 0"));
      } else if (dateRange) {
        if (dateRange.start !== null && dateRange.end !== null) {
          whereClause.spieldatum = {
            [Op.between]: [dateRange.start, dateRange.end]
          };
        } else if (dateRange.start !== null) {
          whereClause.spieldatum = { [Op.gte]: dateRange.start };
        } else if (dateRange.end !== null) {
          whereClause.spieldatum = { [Op.lte]: dateRange.end };
        }
      } else if (hasValue(spieldatum)) {
        const legacyDayRange = getLegacyDayRange(spieldatum);
        if (legacyDayRange) {
          whereClause.spieldatum = {
            [Op.between]: [legacyDayRange.start, legacyDayRange.end]
          };
        }
      }

      const selectedLeagues = parseList(ligaNames);
      if (selectedLeagues.length) {
        whereClause.ligaName = { [Op.in]: selectedLeagues };
      } else if (hasValue(ligaName)) {
        whereClause.ligaName = { [Op.like]: `%${String(ligaName).trim()}%` };
      }

      const selectedVenues = parseList(spielfeldNames);
      if (selectedVenues.length) {
        whereClause.spielfeldName = { [Op.in]: selectedVenues };
      } else if (hasValue(spielfeldName)) {
        whereClause.spielfeldName = { [Op.like]: `%${String(spielfeldName).trim()}%` };
      }

      const selectedLicenses = parseList(srLizenzen);
      if (selectedLicenses.length) {
        whereClause.srLizenz = { [Op.in]: selectedLicenses };
      } else if (hasValue(srLizenz)) {
        whereClause.srLizenz = { [Op.like]: `%${String(srLizenz).trim()}%` };
      }

      const searchTerm = hasValue(search) ? String(search).trim() : "";
      if (searchTerm) {
        const searchConditions = [
          { heimMannschaftName: { [Op.like]: `%${searchTerm}%` } },
          { gastMannschaftName: { [Op.like]: `%${searchTerm}%` } },
          { sr1VereinName: { [Op.like]: `%${searchTerm}%` } },
          { sr2VereinName: { [Op.like]: `%${searchTerm}%` } },
          { sr3VereinName: { [Op.like]: `%${searchTerm}%` } },
          { ligaName: { [Op.like]: `%${searchTerm}%` } },
          { spielfeldName: { [Op.like]: `%${searchTerm}%` } },
          { spielStrasse: { [Op.like]: `%${searchTerm}%` } },
          { spielPlz: { [Op.like]: `%${searchTerm}%` } },
          { spielOrt: { [Op.like]: `%${searchTerm}%` } }
        ];

        addAndCondition(whereClause, { [Op.or]: searchConditions });
      }

      if (nearbyFilterRequested && distanceExpression && requestedRadiusKm !== null) {
        addAndCondition(whereClause, literal(`${distanceExpression} <= ${requestedRadiusKm}`));
      }

      // Der vorbereitete Ausfallfilter bezieht sich auf den aktuellen Kontext,
      // darf sich für seine eigene Verfügbarkeit aber nicht selbst einschließen.
      const availableRiskWhere = cloneWhereClause(whereClause);
      const riskWhere = {
        ...availableRiskWhere,
        sr1OffenAngeboten: true,
        sr2OffenAngeboten: true
      };
      if (atRiskOnly === true || atRiskOnly === "true") {
        whereClause.sr1OffenAngeboten = true;
        whereClause.sr2OffenAngeboten = true;
      }

      const lseWhere = cloneWhereClause(whereClause);
      delete lseWhere.srLizenz;
      lseWhere.srLizenz = "LSE";

      const allSpiele = await Spiel.findAll({
        attributes: getFilterAttributes()
      });
      const [atRiskCount, lseCount] = await Promise.all([
        Spiel.count({ where: riskWhere }),
        Spiel.count({ where: lseWhere })
      ]);
      const availableFilters = {
        ...getAvailableFilters(allSpiele),
        atRiskCount: Number(atRiskCount) || 0,
        lseCount: Number(lseCount) || 0
      };
      const distanceAttributes = distanceExpression
        ? { include: [[literal(distanceExpression), "distanceKm"]] }
        : undefined;
      const spieleQuery = {
        where: whereClause,
        include: getGameIncludes(),
        order: getSortOrder(finalSortBy, finalSortOrder, distanceExpression),
        limit: pageSize,
        offset
      };
      if (distanceAttributes) spieleQuery.attributes = distanceAttributes;

      const { count, rows: spiele } = await Spiel.findAndCountAll(spieleQuery);

      const totalPages = Math.ceil(count / pageSize);
      const hasNextPage = pageNumber < totalPages;
      const hasPrevPage = pageNumber > 1;

      const spieleMitFormatiertemDatum = spiele.map((spiel) => {
        const spielData = spiel.toJSON();
        if (spielData.spieldatum) {
          const datum = new Date(Number.parseInt(spielData.spieldatum, 10));
          spielData.datum = datum.toLocaleString("de-DE", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            timeZone: "Europe/Berlin"
          });
          spielData.zeit = datum.toLocaleString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Berlin"
          });

        }

        const rawData = parseJsonValue(spielData.rawData);
        spielData.sr1 = getRefereePresence(rawData, "sr1");
        spielData.sr2 = getRefereePresence(rawData, "sr2");
        spielData.sr3 = getRefereePresence(rawData, "sr3");
        spielData.isAtRisk = isGameAtRisk(spielData);

        if (spielData.distanceKm !== null && spielData.distanceKm !== undefined) {
          const parsedDistance = Number(spielData.distanceKm);
          spielData.distanceKm = Number.isFinite(parsedDistance) ? parsedDistance : null;
        }

        delete spielData.rawData;
        delete spielData.sr1VereinId;
        delete spielData.sr2VereinId;
        delete spielData.sr3VereinId;
        delete spielData.srQualifikationId;
        delete spielData.createdAt;
        delete spielData.updatedAt;
        delete spielData.heimVereinId;
        delete spielData.gastVereinId;
        return spielData;
      });

      res.json({
        success: true,
        data: {
          spiele: spieleMitFormatiertemDatum,
          pagination: {
            currentPage: pageNumber,
            pageSize,
            totalItems: count,
            totalPages,
            hasNextPage,
            hasPrevPage,
            nextPage: hasNextPage ? pageNumber + 1 : null,
            prevPage: hasPrevPage ? pageNumber - 1 : null
          },
          availableFilters
        }
      });
    } catch (error) {
      console.error("Fehler beim Abrufen der Spiele:", error);
      res.status(500).json({
        success: false,
        error: "Fehler beim Abrufen der Spiele",
        details: error.message
      });
    }
  }
}

module.exports = new SpieleController();
