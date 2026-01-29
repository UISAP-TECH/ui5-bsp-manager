/**
 * @namespace <%= namespace %>.service
 * @name <%= namespace %>.service.ODataV2Service
 * @description OData V2 service for making AJAX requests to the server.
 */
sap.ui.define([
  "sap/ui/base/Object"
], function (BaseObject) {
  "use strict";

  return BaseObject.extend("<%= namespace %>.service.ODataV2Service", {

    /**
     * Constructor
     * @param {sap.ui.model.odata.v2.ODataModel} oODataModel - The OData V2 model instance.
     */
    constructor: function (oODataModel) {
      BaseObject.prototype.constructor.apply(this, arguments);
      this._oModel = oODataModel;
    },

    /**
     * Refreshes the CSRF token for the model.
     * @returns {Promise<void>} A promise that resolves when the token is fetched.
     */
    fetchToken: function () {
      return new Promise((resolve, reject) => {
        this._oModel.refreshSecurityToken(resolve, reject);
      });
    },

    /**
     * Reads data from an OData V2 service.
     * @param {string} sPath - The path to the entity set (e.g., "/ProductSet").
     * @param {object} [oParameters] - Optional OData parameters ($filter, $expand, etc.).
     * @returns {Promise<object>} A promise that resolves with the response data.
     */
    read: function (sPath, oParameters) {
      return new Promise((resolve, reject) => {
        this._oModel.read(sPath, {
          urlParameters: oParameters,
          success: (oData) => resolve(oData),
          error: (oError) => reject(this._parseError(oError))
        });
      });
    },

    /**
     * Creates a new entry in an entity set.
     * @param {string} sPath - The path to the entity set (e.g., "/ProductSet").
     * @param {object} oData - The data for the new entry.
     * @returns {Promise<object>} A promise that resolves with the created entry data.
     */
    create: function (sPath, oData) {
      return new Promise((resolve, reject) => {
        this._oModel.create(sPath, oData, {
          success: (oResult) => resolve(oResult),
          error: (oError) => reject(this._parseError(oError))
        });
      });
    },

    /**
     * Updates an existing entry.
     * @param {string} sPath - The path to the specific entry (e.g., "/ProductSet('123')").
     * @param {object} oData - The data to update.
     * @returns {Promise<void>} A promise that resolves on successful update.
     */
    update: function (sPath, oData) {
      return new Promise((resolve, reject) => {
        this._oModel.update(sPath, oData, {
          success: () => resolve(),
          error: (oError) => reject(this._parseError(oError))
        });
      });
    },

    /**
     * Deletes an entry.
     * @param {string} sPath - The path to the specific entry (e.g., "/ProductSet('123')").
     * @returns {Promise<void>} A promise that resolves on successful deletion.
     */
    remove: function (sPath) {
      return new Promise((resolve, reject) => {
        this._oModel.remove(sPath, {
          success: () => resolve(),
          error: (oError) => reject(this._parseError(oError))
        });
      });
    },
    
    /**
     * Parses the OData error object to a simpler format.
     * @param {object} oError - The error object from the OData model.
     * @returns {object} A simplified error object.
     * @private
     */
    _parseError: function(oError) {
        try {
            const errorBody = JSON.parse(oError.responseText);
            return {
                statusCode: oError.statusCode,
                message: errorBody.error.message.value,
                details: errorBody.error.innererror?.errordetails || []
            };
        } catch (e) {
            return {
                statusCode: oError.statusCode,
                message: oError.message || "An unknown error occurred."
            };
        }
    }
  });
});