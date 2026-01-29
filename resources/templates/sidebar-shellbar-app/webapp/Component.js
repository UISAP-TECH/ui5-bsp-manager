<% if (serviceType === 'Rest') { %>
sap.ui.define([
    "sap/ui/core/UIComponent",
    "./model/models"
    <% if (includeLogin) { %>
    ,"./service/SessionManager",
    "./service/UserService"
    <% } %>
], function (UIComponent, models<% if (includeLogin) { %>, SessionManager, UserService<% } %>) {
    "use strict";

    /* ---------------------------------------------------------------- */
    /*                            global sap                            */
    /* ---------------------------------------------------------------- */

    return UIComponent.extend("<%= namespace %>.Component", {
        metadata: {
            manifest: "json",
            interfaces: ["sap.ui.core.IAsyncContentCreation"]
        },

        /**
         * @brief Initializes the component.
         */
        init: function () {
            const oUriParams = new URLSearchParams(window.location.search);
            let sLanguage = oUriParams.get("sap-language");

            if (!sLanguage) {
                sLanguage = localStorage.getItem("userLanguage");
            }
            if (!sLanguage) {
                sLanguage = sap.ui
                    .getCore()
                    .getConfiguration()
                    .getLanguage()
                    .substring(0, 2);
            }
            if (sLanguage !== "tr" && sLanguage !== "en") {
                sLanguage = "tr";
            }

            sap.ui.getCore().getConfiguration().setLanguage(sLanguage);
            localStorage.setItem("userLanguage", sLanguage);

            UIComponent.prototype.init.apply(this, arguments);

            <% if (includeLogin) { %>
            this._initializeApp(oUriParams);
            <% } else { %>
            this.setModel(models.createDeviceModel(), "device");
            this.getRouter().initialize();
            <% } %>
        },

        <% if (includeLogin) { %>
        /**
         * @brief Initializes the application.
         * @param {URLSearchParams} oUriParams - The URI parameters.
         * Initializes the application and calls the _continueInitialization method.
         */
        _initializeApp: function (oUriParams) {
            const sTokenFromUrl = oUriParams.get("token");

            if (sTokenFromUrl) {
                UserService.validateToken(sTokenFromUrl)
                    .then(() => this._continueInitialization(true))
                    .catch(() => this._continueInitialization(false));
            } else {
                this._continueInitialization(false);
            }
        },

        /**
         * @brief Continues the initialization of the application.
         * Continues the initialization of the application and calls the _continueInitialization method.
         */
        _continueInitialization: function (bIsLoggedIn) {
            SessionManager.init(this);
            this.setModel(models.createDeviceModel(), "device");
            this.getRouter().initialize();
            this.getRouter().attachRouteMatched(this._onRouteMatched, this);

            if (bIsLoggedIn) {
                this.getRouter().navTo("Home", {}, true);
            } else if (!SessionManager.isAuthenticated()){
                this.getRouter().navTo("Login", {}, true);
            }
        },

        /**
         * @brief Handles the route matched event.
         * Handles the route matched event and checks if the route requires authentication.
         */
        _onRouteMatched: function (oEvent) {
            const oRouteConfig = oEvent.getParameter("config");
            const sRouteName = oEvent.getParameter("name");
            
            if (oRouteConfig.requiresAuth && !SessionManager.isAuthenticated()) {
                console.warn("Erişim engellendi: Oturum gerekli. Login sayfasına yönlendiriliyor.");
                this.getRouter().navTo("Login", {}, true);
            } else if (sRouteName === "Login" && SessionManager.isAuthenticated()){
                 this.getRouter().navTo("Home", {}, true);
            }
        }
        <% } %>
    });
});
<% } else { %>
sap.ui.define([
    "sap/ui/core/UIComponent",
    "<%= namespace %>/model/models"
    <% if (serviceType === 'ODataV2') { %>
    ,"<%= namespace %>/service/ODataV2Service"
    <% } else if (serviceType === 'ODataV4') { %>
    ,"<%= namespace %>/service/ODataV4Service"
    <% } %>
], function (UIComponent, models<% if (serviceType === 'ODataV2') { %>, ODataV2Service<% } else if (serviceType === 'ODataV4') { %>, ODataV4Service<% } %>) {
    "use strict";

    /* ---------------------------------------------------------------- */
    /*                            global sap                            */
    /* ---------------------------------------------------------------- */
    return UIComponent.extend("<%= namespace %>.Component", {
        metadata: { manifest: "json" },

        /**
         * @brief Initializes the component.
         * Initializes the component and calls the _initializeApp method.
         */
        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            <% if (serviceType === 'ODataV2') { %>
            this.oDataV2Service = new ODataV2Service(this.getModel("oDataV2Model"));
            <% } else if (serviceType === 'ODataV4') { %>
            this.oDataV4Service = new ODataV4Service(this.getModel("oDataV4Model"));
            <% } %>
            this.getRouter().initialize();
            this.setModel(models.createDeviceModel(), "device");
        },

        <% if (serviceType === 'ODataV2') { %>
        /**
         * @brief Gets the OData V2 service.
         * Gets the OData V2 service and returns it.
         */
        getODataV2Service: function() { return this.oDataV2Service; }
        <% } else if (serviceType === 'ODataV4') { %>
        /**
         * @brief Gets the OData V4 service.
         * Gets the OData V4 service and returns it.
         */
        getODataV4Service: function() { return this.oDataV4Service; }
        <% } %>
    });
});
<% } %>