/**
 * @namespace <%= namespace %>.service
 * @name <%= namespace %>.service.SessionManager
 * @description Session management service.
 * Manages the browser storage (sessionStorage) and the global UI5 model.
 */
sap.ui.define(
  [
    "sap/ui/util/Storage",
    "sap/ui/model/json/JSONModel",
    "./RestService",
  ],
  function (Storage, JSONModel, RestService) {
    "use strict";

    /* ---------------------------------------------------------------------------------------------- */
    /*                                           global sap                                           */
    /* ---------------------------------------------------------------------------------------------- */

    let _oSessionModel;
    const _oStorage = new Storage(Storage.Type.local, "<%= namespace %>_session");

    const SessionManager = {
      /**
       * @brief Initializes the session manager.
       * @param {sap.ui.core.UIComponent} oComponent The component instance.
       */
      init: function (oComponent) {
        const oInitialData = {
          isAuthenticated: false,
          token: null,
          user: null,
        };
        _oSessionModel = new JSONModel(oInitialData);
        oComponent.setModel(_oSessionModel, "session");

        const sStoredData = _oStorage.get("sessionData");
        if (sStoredData) {
          try {
            const oStoredData = JSON.parse(sStoredData);
            if (oStoredData.token && oStoredData.user) {
              this._updateSessionState(oStoredData.user, oStoredData.token);
            }
          } catch (e) {
            console.error(
              "SessionManager: Session data in the repository could not be read.",
              e
            );
            this.logout();
          }
        }
      },

      /**
       * @brief Logs in the user.
       * @param {object} oUserData The user data received from the server.
       * @param {string} sToken The JWT or session token received from the server.
       */
      login: function (oUserData, sToken) {
        this._updateSessionState(oUserData, sToken);

        const sDataToStore = JSON.stringify({
          user: oUserData,
          token: sToken,
        });
        _oStorage.put("sessionData", sDataToStore);
      },

      /**
       * @brief Logs out the user.
       */
      logout: function () {
        _oSessionModel.setData({
          isAuthenticated: false,
          token: null,
          user: null,
        });

        RestService.clearAuthToken();
        RestService.clearCredentials();

        _oStorage.remove("sessionData");
        console.log("SessionManager: Oturum başarıyla sonlandırıldı.");
      },

      /**
       * @brief Returns the global session model.
       * @returns {sap.ui.model.json.JSONModel}
       */
      getSessionModel: function () {
        return _oSessionModel;
      },

      /**
       * @brief Checks if the user is authenticated.
       * @returns {boolean}
       */
      isAuthenticated: function () {
        return _oSessionModel.getProperty("/isAuthenticated");
      },

      /**
       * @brief Returns the current session token.
       * @returns {string|null}
       */
      getToken: function () {
        return _oSessionModel.getProperty("/token");
      },

      /**
       * @brief Updates the session state.
       * @private
       */
      _updateSessionState: function (oUser, sToken) {
        _oSessionModel.setData({
          isAuthenticated: true,
          token: sToken,
          user: oUser,
        });

        RestService.setAuthToken(sToken);
      },
    };

    return SessionManager;
  }
);
