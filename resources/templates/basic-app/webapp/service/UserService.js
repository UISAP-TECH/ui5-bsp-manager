/**
 * @namespace <%= namespace %>.service
 * @name <%= namespace %>.service.UserService
 * @description User operations (login, logout, profile information, etc.) service.
 */
sap.ui.define(
  ["./RestService", "./SessionManager"],
  function (RestService, SessionManager) {
    "use strict";

    /* ---------------------------------------------------------------------------------------------- */
    /*                                           global sap                                           */
    /* ---------------------------------------------------------------------------------------------- */

    return {
      /**
       * @brief Logs in the user.
       * @param {string} sUsername The username.
       * @param {string} sPassword The password.
       * @returns {Promise<{user: object, token: string}>} A Promise that resolves with the user data if the login is successful.
       */
      login: async function (sUsername, sPassword) {
        RestService.setCredentials(sUsername, sPassword);
        try {
          const oResponse = await RestService.post("/auth/login", {});
          const sToken = oResponse.es_authtoken;
          const oUserData = oResponse.es_user_data;

          if (sToken && oUserData) {
            SessionManager.login(oUserData, sToken);
            return { user: oUserData, token: sToken };
          } else {
            throw new Error(
              "The authorization key (token) or user data could not be obtained from the server."
            );
          }
        } catch (oError) {
          RestService.clearCredentials();
          throw oError;
        }
      },

      /**
       * @brief Validates the token and returns the user data.
       * @param {string} sToken The token.
       * @returns {Promise<{user: object, token: string}>} A Promise that resolves with the user data if the token is valid.
       */
      validateToken: async function (sToken) {
        RestService.setAuthToken(sToken);
        try {
          const oResponse = await RestService.post("/auth/validate", {});
          const oUserData = oResponse.es_user_data;

          if (oUserData) {
            SessionManager.login(oUserData, sToken);
            return { user: oUserData, token: sToken };
          } else {
            throw new Error(
              "Token validation failed or user data could not be obtained."
            );
          }
        } catch (oError) {
          SessionManager.logout();
          throw oError;
        }
      },

      /**
       * @brief Logs out the user.
       * @returns {Promise<void>} A Promise that resolves when the logout is complete.
       */
      logout: async function () {
        SessionManager.logout();
      },
    };
  }
);
