sap.ui.define(["sap/ui/core/mvc/Controller"], function (Controller) {
  "use strict";

  /* ---------------------------------------------------------------------------------------------- */
  /*                                           global sap                                           */
  /* ---------------------------------------------------------------------------------------------- */

  return Controller.extend("<%= namespace %>.controller.NotFound", {
    /**
     * @brief Controller ilk yüklendiğinde bir kez çalışır.
     * Olay dinleyicilerini ve sabit referansları tanımlamak için kullanılır.
     */
    onInit: function () {},
  });
});
