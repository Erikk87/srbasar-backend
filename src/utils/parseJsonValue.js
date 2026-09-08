const parseJsonValue = (value) => {
  if (value && typeof value === 'object') {
    return value;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return {};
  }

  try {
    const parsedValue = JSON.parse(value);
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
  } catch {
    return {};
  }
};

module.exports = parseJsonValue;
