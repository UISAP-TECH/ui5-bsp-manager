sap.ui.define([
  "sap/ui/base/Object",
  "sap/m/MessageBox"
], function (BaseObject, MessageBox) {
  "use strict";

  return BaseObject.extend("<%= namespace %>.service.ODataV4Service", {

    /**
     * Constructor
     * @param {sap.ui.model.odata.v4.ODataModel} oODataModel - The OData V4 model instance.
     */
    constructor: function (oODataModel) {
      BaseObject.prototype.constructor.apply(this, arguments);
      this._oModel = oODataModel;

      // Otomatik mesaj yönetimi için MessageManager'ı dinle
      this._attachMessageManager();
    },

    /**
     * Programmatically reads a list of entities.
     * Usually, data is consumed via view bindings, but this is useful for manual reads.
     * @param {sap.ui.list.ListBase} oList - The list control to bind.
     * @param {string} sPath - The path to the entity set (e.g., "/Products").
     * @param {object} [oParameters] - Optional OData parameters ($filter, $expand, etc.).
     * @returns {sap.ui.model.odata.v4.ODataListBinding} The created list binding.
     */
    bindList: function (oList, sPath, oParameters) {
        const oBinding = this._oModel.bindList(sPath, null, null, null, oParameters);
        oList.setModel(this._oModel);
        oList.bindItems({
            path: sPath,
            template: oList.getBindingInfo("items").template
        });
        // İsteğin gönderilmesi için context'leri talep et
        oBinding.requestContexts();
        return oBinding;
    },


    /**
     * Creates a new entry in a list binding.
     * The change is pending until 'submitBatch' is called.
     * @param {sap.ui.model.odata.v4.ODataListBinding} oListBinding - The list binding (e.g., from a table).
     * @param {object} oInitialData - The initial data for the new entry.
     * @returns {Promise<sap.ui.model.odata.v4.Context>} A promise that resolves with the context of the created entry.
     */
    create: function (oListBinding, oInitialData) {
      return new Promise((resolve, reject) => {
        const oContext = oListBinding.create(oInitialData);

        oContext.created().then(() => {
          // 'submitBatch' başarılı olduğunda bu promise resolve olur.
          resolve(oContext);
        }).catch((oError) => {
          // Eğer oluşturma işlemi sunucuda başarısız olursa
          oContext.delete(); // İstemcideki değişikliği geri al
          reject(oError);
        });
      });
    },

    /**
     * Deletes an entity.
     * The change is pending until 'submitBatch' is called.
     * @param {sap.ui.model.odata.v4.Context} oContext - The context of the entry to be deleted.
     * @returns {Promise<void>} A promise that resolves when the deletion is successfully sent to the server.
     */
    remove: function(oContext) {
        // V4'te silme işlemi doğrudan context üzerinden yapılır ve bir Promise döner.
        // Bu Promise, submitBatch çağrısından sonra tamamlanır.
        return oContext.delete();
    },
    
    /**
     * Submits pending changes for a specific group.
     * @param {string} sGroupId - The batch group ID (e.g., "$auto" or a custom one like "updateGroup").
     * @returns {Promise<void>} A promise that resolves when the batch is successfully processed.
     */
    submitBatch: function(sGroupId) {
        return this._oModel.submitBatch(sGroupId);
    },

    /**
     * Attaches to the message manager to automatically display errors from the OData V4 model.
     * @private
     */
    _attachMessageManager: function() {
        const oMessageManager = sap.ui.getCore().getMessageManager();
        const oMessageModel = oMessageManager.getMessageModel();
        
        oMessageManager.registerObject(this._oView, true); // View'a bağlayarak UI elemanlarındaki hataları da yakalar

        oMessageModel.attachMessageChange((oEvent) => {
            const aMessages = oEvent.getParameter("newMessages");
            if (aMessages.length > 0) {
                const sErrors = aMessages.map(m => m.getMessage()).join("\n");
                MessageBox.error(sErrors);
            }
        });
    }

  });
});