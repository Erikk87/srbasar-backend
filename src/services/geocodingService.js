const axios = require("axios");
const { getCoordinates } = require("../utils/coordinates");

const DEFAULT_GEOCODING_API_URL = "https://photon.komoot.io/api/";
const DEFAULT_GEOCODING_TIMEOUT_MS = 5000;

const parsePositiveInteger = (value, fallback) => {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
};

const normalizePart = (value) => String(value || "")
  .trim()
  .replace(/\s+/g, " ")
  .toLowerCase();

const getAddressKey = ({ street, postalCode, city } = {}) => {
  const parts = [street, postalCode, city].map(normalizePart);
  return parts.some(Boolean) ? parts.join("|") : null;
};

const isValidCoordinates = (coordinates) => {
  if (!coordinates) return false;

  return getCoordinates(coordinates.latitude, coordinates.longitude) !== null;
};

class GeocodingService {
  constructor() {
    this.client = axios.create({
      baseURL: process.env.GEOCODING_API_URL || DEFAULT_GEOCODING_API_URL,
      timeout: parsePositiveInteger(
        process.env.GEOCODING_TIMEOUT_MS,
        DEFAULT_GEOCODING_TIMEOUT_MS
      ),
      headers: {
        Accept: "application/json",
        "User-Agent": "srbasar-backend/1.0 (+https://srbasar.de)",
      },
    });
    this.cache = new Map();
    this.pendingRequests = new Map();
  }

  async geocodeAddress(address) {
    const key = getAddressKey(address);
    if (!key) return null;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.pendingRequests.has(key)) return this.pendingRequests.get(key);

    const query = [address.street, address.postalCode, address.city, "Deutschland"]
      .filter(Boolean)
      .join(", ");
    const request = this.client.get("", {
      params: {
        q: query,
        limit: 1,
      },
    }).then((response) => {
      const coordinates = this.extractCoordinates(response.data);
      if (coordinates) this.cache.set(key, coordinates);
      return coordinates;
    }).finally(() => {
      this.pendingRequests.delete(key);
    });

    this.pendingRequests.set(key, request);
    return request;
  }

  extractCoordinates(payload) {
    const values = payload?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(values) || values.length < 2) return null;

    return getCoordinates(values[1], values[0]);
  }
}

module.exports = {
  GeocodingService,
  getAddressKey,
  isValidCoordinates,
};
