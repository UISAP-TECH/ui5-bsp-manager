/**
 * @namespace <%= namespace %>.service
 * @name <%= namespace %>.service.RestService
 * @description REST service for making AJAX requests to the server.
 */
sap.ui.define([], function () {
  "use strict";

  /* ---------------------------------------------------------------- */
  /*                           global sap, $                          */
  /* ---------------------------------------------------------------- */

  let _sToken = null;
  let _username = null;
  let _password = null;

  return {
    /**
     * @brief A function that sets the authentication token.
     * Called when the login process is successful.
     * @param {string} sNewToken - The new authentication token.
     */
    setAuthToken: function (sNewToken) {
      _sToken = sNewToken;
    },

    /**
     * @brief A function that clears the authentication token.
     * Called when the logout process is successful.
     */
    clearAuthToken: function () {
      _sToken = null;
    },

    /**
     * @brief A function that sets the username and password.
     * Called when the login process is successful.
     * @param {string} sUsername - The username.
     * @param {string} sPassword - The password.
     */
    setCredentials: function (sUsername, sPassword) {
      _username = sUsername;
      _password = sPassword;
    },

    /**
     * @brief A function that clears the username and password.
     * Called when the logout process is successful.
     */
    clearCredentials: function () {
      _username = null;
      _password = null;
    },

    /**
     * @brief A function that checks the es_return structure and returns an error object if an error is found.
     * @param {object} oResponse The service response.
     * @param {string} sEndpoint The endpoint name (for error message).
     * @returns {Array} An array of error messages.
     * @private
     */
    _checkEsReturn: function (oResponse, sEndpoint) {
      const aErrors = [];
      if (oResponse?.es_return?.type === "E") {
        if (oResponse.et_hata?.length > 0) {
          oResponse.et_hata.forEach((oItem) => {
            if (oResponse?.es_return?.type === "E") {
              aErrors.push({
                type: "Error",
                title: `Error: ${sEndpoint}`,
                description: oItem.message || "An unknown error occurred.",
                subtitle: "Please contact the system administrator.",
              });
            }
          });
        } else {
          aErrors.push({
            type: "Error",
            title: `Error: ${sEndpoint}`,
            description:
              oResponse.es_return.message || "An unknown error occurred.",
            subtitle: "Please contact the system administrator.",
          });
        }
      }

      return aErrors;
    },

    /**
     * @brief A function that makes an AJAX request to the server.
     * @param {string} sEndpoint The endpoint name (for error message).
     * @param {string} sMethod HTTP method (GET, POST, PUT, DELETE)
     * @param {object} oData Data to send
     * @returns {Promise}
     * @private
     */
    _ajaxRequest: function (sEndpoint, sMethod, oData = {}, async = true) {
      const _this = this;
      return new Promise((resolve, reject) => {
        const oHeaders = {};

        if (_sToken) {
          // oHeaders.Authorization = "Bearer " + _sToken;
        }

        if (_username && _password) {
          const sCredentials = `${_username}:${_password}`;
          const sEncodedCredentials = btoa(sCredentials);
          oHeaders.Authorization = "Basic " + sEncodedCredentials;
        }

        $.ajax({
          url: sEndpoint,
          headers: oHeaders,
          method: sMethod,
          data: sMethod !== "GET" ? JSON.stringify(oData) : null,
          dataType: "json",
          contentType: "application/json",
          async: async,
          success: function (response) {
            const aErrors = _this._checkEsReturn(response, sEndpoint);
            if (aErrors.length > 0) {
              reject({ messages: aErrors });
            } else {
              resolve(response);
            }
          },
          error: function (oError) {
            const oErrorInfo = {
              status: oError.status,
              message: oError.responseText || "An unknown error occurred.",
              response: oError.responseJSON || oError.responseText,
            };
            reject(oErrorInfo);
          },
        });
      });
    },

    /**
     * @brief A function that sends a GET request.
     * @param {string} sEndpoint
     * @returns {Promise}
     */
    get: function (sEndpoint) {
      return this._ajaxRequest(sEndpoint, "GET", {}, true);
    },

    /**
     * @brief A function that sends a POST request.
     * @param {string} sEndpoint
     * @param {object} oData
     * @returns {Promise}
     */
    post: function (sEndpoint, oData) {
      return this._ajaxRequest(sEndpoint, "POST", oData, true);
    },

    /**
     * @brief A function that sends a PUT request.
     * @param {string} sEndpoint
     * @param {object} oData
     * @returns {Promise}
     */
    put: function (sEndpoint, oData) {
      return this._ajaxRequest(sEndpoint, "PUT", oData, true);
    },

    /**
     * @brief A function that sends a DELETE request.
     * @param {string} sEndpoint
     * @returns {Promise}
     */
    del: function (sEndpoint) {
      return this._ajaxRequest(sEndpoint, "DELETE", {}, true);
    },
  };
});
