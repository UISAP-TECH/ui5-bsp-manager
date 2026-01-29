sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
  ],
  function (Controller, UIComponent, JSONModel, MessageBox) {
    "use strict";

    /* ---------------------------------------------------------------------------------------------- */
    /*                                           global sap                                           */
    /* ---------------------------------------------------------------------------------------------- */

    return Controller.extend("<%= namespace %>.controller.BaseController", {
      /**
       * Convenience method for accessing the component of the controller's view.
       * @returns {sap.ui.core.Component} The component of the controller's view
       */
      getOwnerComponent: function () {
        return Controller.prototype.getOwnerComponent.call(this);
      },

      /**
       * Convenience method to get the components' router instance.
       * @returns {sap.m.routing.Router} The router instance
       */
      getRouter: function () {
        return UIComponent.getRouterFor(this);
      },

      /**
       * @brief A central and secure helper function for retrieving i18n texts.
       * @param {string} sKey The key of the text in the i18n file.
       * @param {Array} [aParams] The parameters to be inserted into the text (optional).
       * @returns {string} The requested translated text.
       */
      getText: function (sKey, aParams) {
        const oResourceBundle = this.getOwnerComponent().oResourceBundle;
        if (oResourceBundle) {
          return oResourceBundle.getText(sKey, aParams);
        }
        console.warn(
          "ResourceBundle has not been initialized yet, key returned: " + sKey
        );
        return sKey;
      },

      /**
       * Convenience method for getting the view model by name in every controller of the application.
       * @param {string|object} [sName] The model name
       * @returns {sap.ui.model.Model} The model instance
       */
      getModel: function (sName) {
        return this.getOwnerComponent().getModel(sName);
      },

      /**
       * Convenience method for setting the view model in every controller of the application.
       * @param {object|Array} [data] The data to be set in the model
       * @param {string} [sName] The model name
       * @returns {sap.ui.core.mvc.Controller} The current base controller instance
       */
      setModel: function (data, sName) {
        const oModel = new JSONModel();
        oModel.setData(data);
        this.getOwnerComponent().setModel(oModel, sName);
        return this;
      },

      /**
       *  Convenience method for refreshing the model in every controller of the application.
       * @param {string} [sName] The model name
       */
      refreshModel: function (sName) {
        this.getOwnerComponent().getModel(sName).refresh();
      },

      /**
       * Convenience method for getting the event bus of the component.
       * @returns {sap.ui.core.EventBus} The event bus of the component
       */
      getEventBus: function () {
        return this.getOwnerComponent().getEventBus();
      },
      /**
       * A central function for setting the busy property of a model.
       * @param {boolean} bBusy true or false
       * @param {string} [sModelName="settings"] The name of the model. Default is 'settings'.
       * @param {string} [sProperty="/busy"] The path of the property within the model. Default is '/busy'.
       * @public
       */
      setBusy: function (bBusy, sModelName = "settings", sProperty = "/busy") {
        const oModel = this.getModel(sModelName);
        if (oModel) {
          oModel.setProperty(sProperty, bBusy);
        } else {
          this.setModel({}, sModelName)
            .getModel(sModelName)
            .setProperty(sProperty, bBusy);
        }
      },
      /**
       * A central function for handling errors returned from services.
       * Analyzes the error object and displays a user-friendly MessageBox.
       * @param {object} oError The error object returned from the service.
       * @param {string} [sCustomMessage] A custom message to override the error message.
       * @public
       */
      handleServiceError: function (oError, sCustomMessage) {
        console.error("Service Error Details:", oError);

        let sDisplayMessage;

        if (sCustomMessage) {
          sDisplayMessage = sCustomMessage;
        }
        else if (oError?.messages?.[0]?.description) {
          sDisplayMessage = oError.messages[0].description;
        }
        else if (oError?.message) {
          sDisplayMessage = oError.message;
        }
        else {
          sDisplayMessage = this.getText("unexpectedError");
        }

        MessageBox.error(sDisplayMessage);
      },
    });
  }
);
