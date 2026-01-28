/**
 * @namespace <%= namespace %>.service
 * @name <%= namespace %>.service.UserService
 * @description Kullanıcı işlemleri (login, logout, profil bilgileri vb.) için servis.
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
       * Kullanıcıyı sisteme dahil etmek için login isteği gönderir.
       * Bu fonksiyon, önce Basic Authentication için kimlik bilgilerini set eder,
       * ardından login isteğini gönderir. Başarılı olursa, sunucudan gelen
       * Bearer token'ı RestService'e kaydeder ve kullanıcı bilgilerini döndürür.
       *
       * @param {string} sUsername Kullanıcı adı
       * @param {string} sPassword Şifre
       * @returns {Promise<object>} Başarılı olduğunda kullanıcı verilerini içeren bir Promise.
       * Hata durumunda hata nesnesi ile reject olur.
       */
      login: async function (sUsername, sPassword) {
        RestService.setCredentials(sUsername, sPassword);
        try {
          const oResponse = await RestService.post("/auth/login", {});
          const sToken = oResponse.es_authtoken;
          const oUserData = oResponse.es_user_data;

          if (sToken && oUserData) {
            SessionManager.login(oUserData, sToken);
            return oUserData;
          } else {
            throw new Error(
              "Sunucudan yetki anahtarı (token) veya kullanıcı verisi alınamadı."
            );
          }
        } catch (oError) {
          RestService.clearCredentials();
          throw oError;
        }
      },

      /**
       * @brief YENİ: URL'den gelen token'ı doğrulamak ve kullanıcı bilgilerini almak için kullanılır.
       * @param {string} sToken URL'den gelen token.
       * @returns {Promise<object>} Başarılı ise {user, token} nesnesi içeren bir Promise.
       */
      validateToken: async function (sToken) {
        // Önce token'ı RestService'e set et ki, sonraki istek bu token ile gitsin.
        RestService.setAuthToken(sToken);
        try {
          // Backend'deki yeni endpoint'i çağırıyoruz.
          const oResponse = await RestService.post("/auth/validate", {}); // veya GET
          const oUserData = oResponse.es_user_data;

          if (oUserData) {
            // Oturumu bu bilgilerle başlat
            SessionManager.login(oUserData, sToken);
            return { user: oUserData, token: sToken };
          } else {
            throw new Error(
              "Token doğrulama başarısız veya kullanıcı verisi alınamadı."
            );
          }
        } catch (oError) {
          SessionManager.logout(); // Başarısız olursa oturumu temizle
          throw oError;
        }
      },

      /**
       * Kullanıcının oturumunu sonlandırır.
       * Lokaldeki token'ı temizler ve sunucudaki oturumu sonlandırmak için istek gönderir.
       * @returns {Promise}
       */
      logout: async function () {
        // DEĞİŞTİ: Oturumu sonlandırma işini SessionManager'a devret
        SessionManager.logout();

        // Backend'de token'ı geçersiz kılan bir endpoint varsa yine çağrılabilir.
        // return RestService.post("/auth/logout", {});
      },
    };
  }
);
