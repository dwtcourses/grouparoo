import { AuthenticatedAction } from "../classes/authenticatedAction";
import { Import } from "../models/Import";
import { ProfilePropertyRule } from "../models/ProfilePropertyRule";

export class ImportsList extends AuthenticatedAction {
  constructor() {
    super();
    this.name = "imports:list";
    this.description = "list imports";
    this.outputExample = {};
    this.permission = { topic: "import", mode: "read" };
    this.inputs = {
      creatorGuid: { required: false },
      profileGuid: { required: false },
      limit: { required: true, default: 1000, formatter: parseInt },
      offset: { required: true, default: 0, formatter: parseInt },
      order: {
        required: true,
        default: [["createdAt", "desc"]],
      },
    };
  }

  async run({ response, params }) {
    const where = {};

    if (params.creatorGuid) {
      where["creatorGuid"] = params.creatorGuid;
    }

    if (params.profileGuid) {
      where["profileGuid"] = params.profileGuid;
    }

    const search = {
      where,
      limit: params.limit,
      offset: params.offset,
      order: params.order,
    };

    const imports = await Import.findAll(search);
    response.imports = await Promise.all(imports.map((e) => e.apiData()));
    response.total = await Import.count({ where });
  }
}

export class ViewImport extends AuthenticatedAction {
  constructor() {
    super();
    this.name = "import:view";
    this.description = "view an import";
    this.outputExample = {};
    this.permission = { topic: "import", mode: "read" };
    this.inputs = {
      guid: { required: true },
    };
  }

  async run({ response, params }) {
    const _import = await Import.findByGuid(params.guid);
    response.import = await _import.apiData();
  }
}

export class CreateImport extends AuthenticatedAction {
  constructor() {
    super();
    this.name = "import:create";
    this.description = "create an import";
    this.outputExample = {};
    this.permission = { topic: "import", mode: "write" };
    this.inputs = {
      properties: { required: true },
    };
  }

  async run({ response, params }) {
    let { properties } = params;

    if (typeof properties === "string") {
      properties = JSON.parse(properties);
    }

    const profilePropertyRules = await ProfilePropertyRule.cached();
    let foundUniqueProperty = false;
    for (const key in profilePropertyRules) {
      if (profilePropertyRules[key].unique) {
        if (properties[key]) {
          foundUniqueProperty = true;
          break;
        }
      }
    }

    if (!foundUniqueProperty) {
      throw new Error("no unique profile property included");
    }

    const _import = await Import.create({
      data: properties,
      rawData: properties,
      creatorType: "api",
      creatorGuid: "?",
    });

    response.import = await _import.apiData();
  }
}
