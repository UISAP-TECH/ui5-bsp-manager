<% if (serviceType === 'Rest') { %>
// --- REST API İÇİN GELİŞMİŞ Component.js ---
sap.ui.define([
    "sap/ui/core/UIComponent",
    "./model/models",
    "./service/SessionManager",
    "./service/UserService"
], function (UIComponent, models, SessionManager, UserService) {
    "use strict";
    return UIComponent.extend("<%= namespace %>.Component", {
        metadata: {
            manifest: "json",
            interfaces: ["sap.ui.core.IAsyncContentCreation"]
        },
        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            // Dil ayarları ve diğer başlangıç kodları buraya gelebilir...
            this._initializeApp();
        },
        _initializeApp: function () {
            const oUriParams = new URLSearchParams(window.location.search);
            const sTokenFromUrl = oUriParams.get("token");

            if (sTokenFromUrl) {
                UserService.validateToken(sTokenFromUrl)
                    .then(() => this._continueInitialization(true))
                    .catch(() => this._continueInitialization(false));
            } else {
                this._continueInitialization(false);
            }
        },
        _continueInitialization: function (bIsLoggedIn) {
            SessionManager.init(this);
            this.setModel(models.createDeviceModel(), "device");
            this.getRouter().initialize();
            this.getRouter().attachRouteMatched(this._onRouteMatched, this);

            if (bIsLoggedIn) {
                this.getRouter().navTo("Main", {}, true);
            } else if (!SessionManager.isAuthenticated()){
                this.getRouter().navTo("Login", {}, true);
            }
        },
        _onRouteMatched: function (oEvent) {
            const oRouteConfig = oEvent.getParameter("config");
            const sRouteName = oEvent.getParameter("name");
            
            if (oRouteConfig.requiresAuth && !SessionManager.isAuthenticated()) {
                console.warn("Erişim engellendi: Oturum gerekli. Login sayfasına yönlendiriliyor.");
                this.getRouter().navTo("Login", {}, true);
            } else if (sRouteName === "Login" && SessionManager.isAuthenticated()){
                 this.getRouter().navTo("Main", {}, true);
            }
        }
    });
});
<% } else { %>
// --- ODATA İÇİN STANDART Component.js ---
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
    return UIComponent.extend("<%= namespace %>.Component", {
        metadata: { manifest: "json" },
        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            <% if (serviceType === 'ODataV2') { %>
            this.oDataV2Service = new ODataV2Service(this.getModel("oDataV2Model"));
            <% } else if (serviceType === 'ODataV4') { %>
            this.oDataV4Service = new ODataV4Service(this.getModel("oDataV4Model"));
            <% } %>
            this.getRouter().initialize();
            this.setModel(models.createDeviceModel(), "device");
        }
        <% if (serviceType === 'ODataV2') { %>
        ,getODataV2Service: function() { return this.oDataV2Service; }
        <% } else if (serviceType === 'ODataV4') { %>
        ,getODataV4Service: function() { return this.oDataV4Service; }
        <% } %>
    });
});
<% } %>