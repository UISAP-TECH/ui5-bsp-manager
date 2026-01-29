sap.ui.define(["./BaseController", "../util/Formatter"], function (BaseController, Formatter) {
  "use strict";

  /* ---------------------------------------------------------------------------------------------- */
  /*                                           global sap                                           */
  /* ---------------------------------------------------------------------------------------------- */

  return BaseController.extend("<%= namespace %>.controller.Home", {
    formatter: Formatter,
    /**
     * @brief A function that runs once when the controller is loaded.
     * Used to define event listeners and constant references.
     */
    onInit: function () {},
  });
});
