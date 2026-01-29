sap.ui.define(["./BaseController"], function (BaseController) {
  "use strict";

  /* ---------------------------------------------------------------------------------------------- */
  /*                                           global sap                                           */
  /* ---------------------------------------------------------------------------------------------- */

  return BaseController.extend("<%= namespace %>.controller.App", {
    /**
     * @brief A function that runs once when the controller is loaded.
     * Used to define event listeners and constant references.
     */
    onInit: function () {},
  });
});
