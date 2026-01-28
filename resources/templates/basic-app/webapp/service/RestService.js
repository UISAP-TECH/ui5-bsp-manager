/**
 * @namespace <%= namespace %>.service
 * @name <%= namespace %>.service.RestService
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
    // YENİ: Token'ı dışarıdan set etmek için public bir fonksiyon.
    // Login işlemi başarılı olduğunda bu fonksiyon çağrılır.
    setAuthToken: function (sNewToken) {
      _sToken = sNewToken;
    },

    // YENİ: Token'ı temizlemek için public bir fonksiyon.
    // Logout işlemi sırasında bu fonksiyon çağrılır.
    clearAuthToken: function () {
      _sToken = null;
    },

    // YENİ: Kimlik bilgilerini (credentials) dışarıdan set etmek için public bir fonksiyon.
    // Login ekranında kullanıcı bilgileri girince bu fonksiyon çağrılır.
    setCredentials: function (sUsername, sPassword) {
      _username = sUsername;
      _password = sPassword;
    },

    // YENİ: Kimlik bilgilerini temizlemek için public bir fonksiyon.
    // Logout işlemi sırasında bu fonksiyon çağrılır.
    clearCredentials: function () {
      _username = null;
      _password = null;
    },

    /**
     * es_return yapısını kontrol eder ve hata varsa hata nesnesi döndürür.
     * @param {object} oResponse Servis yanıtı
     * @param {string} sEndpoint Endpoint adı (hata mesajı için)
     * @returns {Array} Hata mesajları dizisi
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
                title: `Hata: ${sEndpoint}`,
                description: oItem.message || "Bilinmeyen bir hata oluştu.",
                subtitle: "Lütfen sistem yöneticisi ile iletişime geçin.",
              });
            }
          });
        } else {
          aErrors.push({
            type: "Error",
            title: `Hata: ${sEndpoint}`,
            description:
              oResponse.es_return.message || "Bilinmeyen bir hata oluştu.",
            subtitle: "Lütfen sistem yöneticisi ile iletişime geçin.",
          });
        }
      }

      return aErrors;
    },

    /**
     * Tüm AJAX istekleri için merkezi fonksiyon.
     * @param {string} sEndpoint Çağrılacak API endpoint'i (örn: "/materials")
     * @param {string} sMethod HTTP metodu (GET, POST, PUT, DELETE)
     * @param {object} oData Gönderilecek veri
     * @returns {Promise}
     * @private
     */
    _ajaxRequest: function (sEndpoint, sMethod, oData = {}, async = true) {
      const _this = this;
      return new Promise((resolve, reject) => {
        // YENİ: Her istek için bir başlık (headers) nesnesi oluşturuluyor.
        const oHeaders = {};

        // YENİ: Eğer bir token set edilmişse, onu 'Authorization' başlığı olarak ekle.
        if (_sToken) {
          // oHeaders.Authorization = "Bearer " + _sToken;
        }

        // Eğer kullanıcı adı ve şifre set edilmişse, Basic Auth başlığını oluştur.
        if (_username && _password) {
          const sCredentials = `${_username}:${_password}`; // "kullaniciadi:sifre" formatı
          const sEncodedCredentials = btoa(sCredentials); // btoa() ile Base64 kodlama
          oHeaders.Authorization = "Basic " + sEncodedCredentials;
        }

        $.ajax({
          // 3. DEĞİŞİKLİK: URL'i doğrudan 'models' modülünden alıyoruz.
          url: sEndpoint, // models.getBaseUrl() metodunuzun adını kendi kodunuza göre düzenleyin.
          headers: oHeaders, // DEĞİŞTİ: Başlıklar ajax çağrısına ekleniyor.
          method: sMethod,
          data: sMethod !== "GET" ? JSON.stringify(oData) : null,
          dataType: "json",
          contentType: "application/json",
          async: async,
          success: function (response) {
            // es_return kontrolü
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
              message:
                oError.responseText || "İstek sırasında bir hata oluştu.",
              response: oError.responseJSON || oError.responseText,
            };
            reject(oErrorInfo);
          },
        });
      });
    },

    /**
     * GET isteği gönderir.
     * @param {string} sEndpoint
     * @returns {Promise}
     */
    get: function (sEndpoint) {
      return this._ajaxRequest(sEndpoint, "GET", {}, true);
    },

    /**
     * POST isteği gönderir.
     * @param {string} sEndpoint
     * @param {object} oData
     * @returns {Promise}
     */
    post: function (sEndpoint, oData) {
      return this._ajaxRequest(sEndpoint, "POST", oData, true);
    },

    /**
     * PUT isteği gönderir.
     * @param {string} sEndpoint
     * @param {object} oData
     * @returns {Promise}
     */
    put: function (sEndpoint, oData) {
      return this._ajaxRequest(sEndpoint, "PUT", oData, true);
    },

    /**
     * DELETE isteği gönderir.
     * @param {string} sEndpoint
     * @returns {Promise}
     */
    del: function (sEndpoint) {
      return this._ajaxRequest(sEndpoint, "DELETE", {}, true);
    },
  };
});
