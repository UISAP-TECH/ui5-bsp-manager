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
       * @brief Controller'ın view'ı ilk yüklendiğinde çalışır.
       * View'a özel 'settings' modelini oluşturur, versiyon bilgisini yazar
       * ve başlangıçtaki 'loading' class'ını kaldırır.
       */
      onInit: function () {
        this.setModel({ loginBusy: false }, "settings");

        const v = sap.ui.getCore().getModel("version")?.getData();
        if (v) this.byId("versionText").setText("v" + v.version);
      },
      /**
       * @brief Login butonuna basıldığında tetiklenir.
       * Kullanıcı adı ve şifreyi alarak, mock mod durumuna göre
       * ilgili login fonksiyonunu çağırır ve arayüzdeki busy durumunu yönetir.
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
       * @brief Başarılı login işlemi sonrası çalışır.
       * Hoş geldiniz mesajı gösterir ve kullanıcıyı ana sayfaya yönlendirir.
       * @param {object} oUserData - Giriş yapan kullanıcının bilgilerini içeren nesne.
       * @private
       */
      _onLoginSuccess: function (oUserData) {
        const sWelcomeMessage = this.getText("loginWelcomeMessage", [
          oUserData.username,
        ]);
        toast.success(sWelcomeMessage);
        this.getRouter().navTo("InvoiceTrackReport");
      },
      /**
       * @brief Şifre alanındaki 'göster/gizle' ikonuna tıklandığında çalışır.
       * Input alanının tipini 'Password' ve 'Text' arasında değiştirir.
       * @param {sap.ui.base.Event} oEvent - Olay (event) nesnesi.
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
       * @brief Şifre alanına bir değer girildiğinde anlık olarak çalışır.
       * Input boş ise 'göster/gizle' ikonunu gizler, dolu ise gösterir.
       * @param {sap.ui.base.Event} oEvent - Olay (event) nesnesi.
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
    });
  }
);
