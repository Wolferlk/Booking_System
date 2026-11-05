// Adds the Google Maps key for Android builds when it is set in the build
// environment (EAS: `eas env:create --name GOOGLE_MAPS_ANDROID_API_KEY ...`).
// Without it the app draws the route as a sketch instead of a Google map.
module.exports = ({ config }) => {
  const key = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  if (!key) return config;
  return {
    ...config,
    android: { ...config.android, config: { ...(config.android?.config ?? {}), googleMaps: { apiKey: key } } },
  };
};
