/**
 * @namespace <%= namespace %>.service
 * @name <%= namespace %>.service.SessionManager
 * @description Oturum yönetimi için merkezi servis.
 * Hem tarayıcı deposunu (sessionStorage) hem de global UI5 modelini yönetir.
 */
sap.ui.define(
  [
    "sap/ui/util/Storage",
    "sap/ui/model/json/JSONModel",
    "./RestService", // Token'ı set etmek için RestService'e de ihtiyacımız var
  ],
  function (Storage, JSONModel, RestService) {
    "use strict";

    /* ---------------------------------------------------------------------------------------------- */
    /*                                           global sap                                           */
    /* ---------------------------------------------------------------------------------------------- */

    // Private değişkenler (dışarıdan erişilemez)
    let _oSessionModel;
    // Yeni pencerede oturum aç işlemi yoksa "local" yerine "session" yazılacak
    const _oStorage = new Storage(Storage.Type.local, "<%= namespace %>_session"); // Projeye özel bir anahtar

    // Bu servis, bir singleton gibi çalışacak ve public fonksiyonları döndürecek.
    const SessionManager = {
      /**
       * Uygulama ilk açıldığında Component.js tarafından çağrılmalıdır.
       * Tarayıcı deposundaki eski oturumu kontrol eder ve session modelini başlatır.
       * @param {sap.ui.core.UIComponent} oComponent Uygulamanın ana bileşeni
       */
      init: function (oComponent) {
        const oInitialData = {
          isAuthenticated: false,
          token: null,
          user: null, // Kullanıcı adı, tam adı, rolleri vb. bilgileri burada tutabiliriz
        };
        _oSessionModel = new JSONModel(oInitialData);
        oComponent.setModel(_oSessionModel, "session");

        // 2. Tarayıcı deposunda kayıtlı bir oturum var mı diye kontrol et
        const sStoredData = _oStorage.get("sessionData");
        if (sStoredData) {
          try {
            const oStoredData = JSON.parse(sStoredData);
            if (oStoredData.token && oStoredData.user) {
              // Kayıtlı oturum geçerliyse, modeli ve RestService'i güncelle.
              this._updateSessionState(oStoredData.user, oStoredData.token);
            }
          } catch (e) {
            console.error(
              "SessionManager: Depodaki oturum verisi okunamadı.",
              e
            );
            this.logout(); // Bozuk veriyi temizle
          }
        }
      },

      /**
       * Başarılı bir login işleminden sonra UserService tarafından çağrılır.
       * @param {object} oUserData Sunucudan gelen kullanıcı verileri
       * @param {string} sToken Sunucudan gelen JWT veya session token
       */
      login: function (oUserData, sToken) {
        // Hem modeli hem de depoyu güncelle
        this._updateSessionState(oUserData, sToken);

        // Kalıcı olması için veriyi JSON string olarak tarayıcı deposuna kaydet
        const sDataToStore = JSON.stringify({
          user: oUserData,
          token: sToken,
        });
        _oStorage.put("sessionData", sDataToStore);
      },

      /**
       * Logout işlemi sırasında UserService tarafından çağrılır.
       */
      logout: function () {
        // Modeli başlangıç değerlerine döndür
        _oSessionModel.setData({
          isAuthenticated: false,
          token: null,
          user: null,
        });

        // RestService'deki token ve kimlik bilgilerini temizle
        RestService.clearAuthToken();
        RestService.clearCredentials();

        // Tarayıcı deposundaki oturum verisini sil
        _oStorage.remove("sessionData");
        console.log("SessionManager: Oturum başarıyla sonlandırıldı.");
      },

      /**
       * Global session modelini döndürür.
       * @returns {sap.ui.model.json.JSONModel}
       */
      getSessionModel: function () {
        return _oSessionModel;
      },

      /**
       * Oturumun geçerli olup olmadığını kontrol eder.
       * @returns {boolean}
       */
      isAuthenticated: function () {
        return _oSessionModel.getProperty("/isAuthenticated");
      },

      /**
       * Mevcut oturum token'ını döndürür.
       * @returns {string|null}
       */
      getToken: function () {
        return _oSessionModel.getProperty("/token");
      },

      /**
       * Session state'ini güncelleyen özel yardımcı fonksiyon
       * @private
       */
      _updateSessionState: function (oUser, sToken) {
        // Session modelini güncelle (Bu, tüm UI'ı otomatik olarak güncelleyecektir)
        _oSessionModel.setData({
          isAuthenticated: true,
          token: sToken,
          user: oUser,
        });

        // Sonraki istekler için RestService'e token'ı set et
        RestService.setAuthToken(sToken);
      },
    };

    return SessionManager;
  }
);
