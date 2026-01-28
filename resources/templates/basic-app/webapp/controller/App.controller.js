sap.ui.define(["./BaseController"], function (BaseController) {
  "use strict";

  /* ---------------------------------------------------------------------------------------------- */
  /*                                           global sap                                           */
  /* ---------------------------------------------------------------------------------------------- */

  return BaseController.extend("<%= namespace %>.controller.App", {
    /**
     * @brief Controller ilk yüklendiğinde bir kez çalışır.
     * Olay dinleyicilerini ve sabit referansları tanımlamak için kullanılır.
     */
    onInit: function () {},
  });
});
