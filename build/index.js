var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  activate: () => activate,
  hooks: () => hooks,
  slots: () => slots
});
module.exports = __toCommonJS(index_exports);

// src/lib/ui.js
var import_ui = require("@plugin-host/ui");

// src/index.js
var React = require("react");
var api = require("@plugin-host");
var slots = {};
var hooks = {
  // Needs email:read, declared in manifest.json.
  onEmailOpen(email) {
    if (api.plugin.settings.enabled === false) return;
    api.log.info("Email opened:", email?.subject);
  },
  async onAction({ actionId }) {
    if (actionId !== "test-contacts") {
      return;
    }
    try {
      const contacts = await api.contacts.list();
      api.toast.info(
        `Found ${contacts.length} contacts`
      );
      api.log.info(
        JSON.stringify(
          contacts[0],
          null,
          2
        )
      );
    } catch (err) {
      api.log.error(err);
      api.toast.error(
        String(err)
      );
    }
  }
};
async function publish(pluginApi) {
  await pluginApi.ui.setActions(
    "contact-list-actions",
    [
      {
        id: "test-contacts",
        label: "Test Contacts",
        icon: "search"
      }
    ]
  );
}
async function activate(pluginApi) {
  if (pluginApi.plugin.settings.enabled === false) {
    pluginApi.log.info("Plugin disabled by user settings");
    return;
  }
  await publish(pluginApi);
  pluginApi.i18n.onLocaleChange(() => {
    void publish(pluginApi);
  });
  pluginApi.plugin.onSettingsChange(() => {
    void publish(pluginApi);
  });
}
