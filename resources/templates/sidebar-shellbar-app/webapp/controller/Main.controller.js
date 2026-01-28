sap.ui.define(
  ["./BaseController", "sap/ui/Device"],
  function (BaseController, Device) {
    "use strict";

    /* ---------------------------------------------------------------------------------------------- */
    /*                                           global sap                                           */
    /* ---------------------------------------------------------------------------------------------- */

    return BaseController.extend("<%= namespace %>.controller.Main", {
      /**
       * @override
       * @brief Controller ilk yüklendiğinde çalışır.
       * Gerekli modelleri başlatır, tema ayarlarını yükler ve rota dinleyicisini bağlar.
       */
      onInit: function () {
        this.getRouter().attachRoutePatternMatched(
          this._routePatternMatched,
          this
        );

        // View'a özel modelleri oluştur
        this.setModel({ showNavButton: false }, "App");
      },

      /**
       * @brief Yan menüyü açıp kapatmak için ShellBar'daki butona basıldığında çalışır.
       */
      onShellBarMenuButtonPressed: function () {
        const oToolPage = this.byId("idToolPage");
        oToolPage.setSideExpanded(!oToolPage.getSideExpanded());
      },

      /**
       * @brief Rota her değiştiğinde tetiklenir.
       * Geri butonunun görünürlüğünü ve yan menünün seçili elemanını ayarlar.
       * @param {sap.ui.base.Event} oEvent Rota eşleşme olayı
       * @private
       */
      _routePatternMatched: function (oEvent) {
        const sCurrentRouteName = oEvent.getParameter("name");
        const oNavigation = this.byId("idMenuSideNavigation");

        this.getModel("App").setProperty("/showNavButton", false);

        const oRouteToMenuKeyMap = {
          Home: "Home",
          Settings: "Settings",
        };

        const sMenuKey = oRouteToMenuKeyMap[sCurrentRouteName];
        if (sMenuKey) {
          oNavigation.setSelectedKey(sMenuKey);
        }
      },

      /**
       * @brief ShellBar'daki ana sayfa simgesine basıldığında tetiklenir.
       */
      onShellBarHomeIconPressed: function () {
        this.getRouter().navTo("Home");
      },

      /**
       * @brief Yan menüdeki bir eleman seçildiğinde çalışır.
       * @param {sap.ui.base.Event} oEvent Olay nesnesi
       */
      onSideNavigationItemSelect: function (oEvent) {
        const oItem = oEvent.getParameter("item");
        const sKey = oItem.getKey();

        const sCurrentRouteHash = this.getRouter().getHashChanger().getHash();
        if (sKey === sCurrentRouteHash) {
          if (Device.system.phone) {
            this.byId("idToolPage").setSideExpanded(false);
          }
          return;
        }

        if (Device.system.phone) {
          this.byId("idToolPage").setSideExpanded(false);
        }

        this.getRouter().navTo(sKey);
      },
    });
  }
);
