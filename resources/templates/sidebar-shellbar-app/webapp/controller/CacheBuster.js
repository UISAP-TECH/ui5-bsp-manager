/**
 * @namespace ilbak_srm.controller
 * @name ilbak_srm.controller.CacheBuster
 */
sap.ui.define(["sap/ui/core/ComponentSupport"], function () {
  "use strict";

  /* ---------------------------------------------------------------- */
  /*                           global sap, $                          */
  /* ---------------------------------------------------------------- */

  $.get(
    "./version.json?" + "&__=" + new Date().getTime(),
    function (data) {
      (function () {
        const proxied = window.XMLHttpRequest.prototype.open;
        window.XMLHttpRequest.prototype.open = function () {
          let url = arguments[1];
          if (url.indexOf("?") == -1) {
            url = url + "?";
          }
          arguments[1] = url + "&_AppVersion=" + data._AppVersion;
          return proxied.apply(this, [].slice.call(arguments));
        };
        const proxiedDomappend = Element.prototype.appendChild;
        Element.prototype.appendChild = function () {
          if (
            arguments[0].tagName === "SCRIPT" ||
            arguments[0].tagName === "LINK"
          ) {
            let url =
              arguments[0].src !== undefined
                ? arguments[0].src
                : arguments[0].href;
            if (url.indexOf("?") == -1) {
              url = url + "?";
            }
            if (arguments[0].src !== undefined) {
              if (!arguments[0].src.includes("hyphenopoly")) {
                arguments[0].src = url + "&_AppVersion=" + data._AppVersion;
              }
            } else if (arguments[0].href !== undefined) {
              arguments[0].href = url + "&_AppVersion=" + data._AppVersion;
            }

            return proxiedDomappend.apply(this, [].slice.call(arguments));
          } else {
            return proxiedDomappend.apply(this, arguments);
          }
        };
      })();
      sap.ui.getCore().setModel(new sap.ui.model.json.JSONModel(), "version");
      sap.ui
        .getCore()
        .getModel("version")
        .setData({ version: data._AppVersion });
      return;
    },
    "json"
  );
});
