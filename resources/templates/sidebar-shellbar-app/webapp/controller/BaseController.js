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
       * @brief i18n metinlerini almak için merkezi ve güvenli bir yardımcı fonksiyon.
       * Component'te saklanan oResourceBundle'a erişir.
       * @param {string} sKey i18n dosyasındaki metnin anahtarı.
       * @param {Array} [aParams] Metnin içine yerleştirilecek dinamik parametreler (opsiyonel).
       * @returns {string} İstenen çeviri metni.
       */
      getText: function (sKey, aParams) {
        const oResourceBundle = this.getOwnerComponent().oResourceBundle;
        if (oResourceBundle) {
          return oResourceBundle.getText(sKey, aParams);
        }
        console.warn(
          "ResourceBundle henüz hazır değil, anahtar döndürülüyor: " + sKey
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
       * Bir modeldeki busy özelliğini set etmek için merkezi fonksiyon.
       * @param {boolean} bBusy true veya false
       * @param {string} [sModelName="settings"] Modelin adı. Varsayılan 'settings'.
       * @param {string} [sProperty="/busy"] Model içindeki özelliğin yolu. Varsayılan '/busy'.
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
       * Servislerden dönen hataları merkezi olarak işleyen fonksiyon.
       * Gelen hata nesnesini analiz eder ve kullanıcıya anlaşılır bir MessageBox gösterir.
       * @param {object} oError Servisten dönen hata nesnesi.
       * @param {string} [sCustomMessage] Hata mesajını ezmek için özel bir metin.
       * @public
       */
      handleServiceError: function (oError, sCustomMessage) {
        // Geliştirici için tam hata detayını konsola yazdır.
        console.error("Servis Hatası Detayı:", oError);

        let sDisplayMessage;

        // Eğer özel bir mesaj belirtilmişse, onu kullan.
        if (sCustomMessage) {
          sDisplayMessage = sCustomMessage;
        }
        // RestService'de oluşturduğumuz standart hata yapısını kontrol et.
        else if (oError?.messages?.[0]?.description) {
          sDisplayMessage = oError.messages[0].description;
        }
        // Genel JavaScript hata nesnesini kontrol et.
        else if (oError?.message) {
          sDisplayMessage = oError.message;
        }
        // Hiçbiri yoksa, genel bir hata mesajı göster.
        else {
          sDisplayMessage = this.getText("unexpectedError");
        }

        MessageBox.error(sDisplayMessage);
      },
    });
  }
);
