import { Initializer } from "actionhero";
import { plugin } from "@grouparoo/core";
const packageJSON = require("./../../package.json");

export class EmailAuth extends Initializer {
  constructor() {
    super();
    this.name = packageJSON.name;
  }

  async initialize() {
    plugin.registerPlugin({
      name: packageJSON.name,
    });
  }
}
