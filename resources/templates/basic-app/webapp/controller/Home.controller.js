sap.ui.define(["./BaseController", "../util/Formatter"], function (BaseController, Formatter) {
  "use strict";

  /* ---------------------------------------------------------------------------------------------- */
  /*                                           global sap                                           */
  /* ---------------------------------------------------------------------------------------------- */

  return BaseController.extend("<%= namespace %>.controller.Home", {
    formatter: Formatter,
    /**
     * @brief Controller ilk yüklendiğinde bir kez çalışır.
     * Olay dinleyicilerini ve sabit referansları tanımlamak için kullanılır.
     */
    onInit: function () {},
  });
});
