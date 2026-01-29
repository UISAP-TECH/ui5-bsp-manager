sap.ui.define(
  [
    "./BaseController",
    "../service/UserService",
    "sap/m/library",
  ],
  function (BaseController, UserService, mobileLibrary) {
    "use strict";

    /* ---------------------------------------------------------------- */
    /*                         global sap, toast                        */
    /* ---------------------------------------------------------------- */

    const URLHelper = mobileLibrary.URLHelper;
    return BaseController.extend("<%= namespace %>.controller.Login", {
      /**
       * @override
       * @brief A function that runs once when the controller is loaded.
       * Used to define event listeners and constant references.
       */
      onInit: function () {
        this.setModel({ loginBusy: false }, "settings");

        const v = sap.ui.getCore().getModel("version")?.getData();
        if (v) this.byId("versionText").setText("v" + v.version);
      },
      
      /**
       * @brief A function that runs when the login button is pressed.
       * Retrieves the username and password from the input fields,
       * calls the appropriate login function based on the mock mode,
       * and manages the busy state of the interface.
       */
      onLoginPress: async function () {
        const sUsername = this.byId("idUsernameInput").getValue();
        const sPassword = this.byId("idPasswordInput").getValue();
        this.setBusy(true, "settings", "/loginBusy");

        UserService.login(sUsername, sPassword)
          .then((oUserData) => {
            this._onLoginSuccess(oUserData);
          })
          .catch((oError) => {
            if (oError.message) {
              toast.danger(oError.message);
            } else {
              toast.danger(oError?.messages[0]?.description || "Login failed");
            }
          })
          .finally(() => {
            this.setBusy(false, "settings", "/loginBusy");
          });
      },

      /**
       * @brief A function that runs when the login is successful.
       * Displays a welcome message and navigates the user to the main page.
       * @param {object} oUserData - The user data object containing the user's information.
       * @private
       */
      _onLoginSuccess: function (oUserData) {
        const sWelcomeMessage = this.getText("loginWelcomeMessage", [
          oUserData.username,
        ]);
        toast.success(sWelcomeMessage);
        this.getRouter().navTo("Home");
      },

      /**
       * @brief A function that runs when the 'show/hide' icon in the password field is clicked.
       * Changes the type of the input field between 'Password' and 'Text'.
       * @param {sap.ui.base.Event} oEvent - The event object.
       */
      onInputValueHelpRequest: function (oEvent) {
        const oInput = oEvent.getSource();
        if (oInput.getType() === "Password") {
          oInput.setType("Text");
          oInput.setValueHelpIconSrc("sap-icon://hide");
        } else {
          oInput.setType("Password");
          oInput.setValueHelpIconSrc("sap-icon://show");
        }
        this.byId("idPasswordInput").setValue(oInput.getValue());
      },

      /**
       * @brief A function that runs when the value of the password field changes.
       * Hides the 'show/hide' icon if the input is empty, shows it if the input is not empty.
       * @param {sap.ui.base.Event} oEvent - The event object.
       */
      onInputLiveChange: function (oEvent) {
        const oInput = oEvent.getSource();
        if (oInput.getValue() === "") {
          oInput.setShowValueHelp(false);
          oInput.removeStyleClass("password");
        } else {
          oInput.setShowValueHelp(true);
          oInput.addStyleClass("password");
        }
      },

      /**
       * @brief Our company logo is clicked.
       * Opens the contact page of our company in a new tab.
       */
      onNavigateToOurCompany: function () {
        const oManifestEntry = this.getOwnerComponent().getManifestEntry(
          "/sap.app/dataSources/ourCompanyHomepage"
        );
        URLHelper.redirect(oManifestEntry.uri, true);
      },

      /**
       * @brief Client company logo is clicked.
       * Opens the web site of the client company in a new tab.
       */
      onNavigateToClientCompany: function () {
        const oManifestEntry = this.getOwnerComponent().getManifestEntry(
          "/sap.app/dataSources/clientCompanyHomepage"
        );
        URLHelper.redirect(oManifestEntry.uri, true);
      },
    });
  }
);
