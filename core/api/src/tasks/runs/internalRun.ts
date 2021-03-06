import { Task, task, api, config } from "actionhero";
import { Run } from "../../models/Run";
import { Import } from "../../models/Import";
import { Profile } from "../../models/Profile";
import { plugin } from "../../modules/plugin";

export class DetermineRunState extends Task {
  constructor() {
    super();
    this.name = "run:internalRun";
    this.description = "build imports that will check and sync all profiles";
    this.frequency = 0;
    this.queue = "runs";
    this.inputs = {
      runGuid: { required: true },
      limit: { required: false },
      offset: { required: false },
    };
  }

  async run(params) {
    const offset: number = params.offset || 0;
    const limit: number =
      params.limit ||
      parseInt(
        (await plugin.readSetting("core", "runs-profile-batch-size")).value
      );

    const run = await Run.findByGuid(params.runGuid);

    if (run.state === "stopped") {
      return;
    }

    const profiles = await Profile.findAll({
      order: [["createdAt", "asc"]],
      limit,
      offset,
    });

    for (const i in profiles) {
      const profile = profiles[i];
      const transaction = await api.sequelize.transaction();

      const _import = await Import.create(
        {
          profileGuid: profile.guid,
          rawData: {},
          data: {},
          creatorType: "run",
          creatorGuid: run.guid,
        },
        { transaction }
      );

      await run.increment(["importsCreated"], { transaction });
      await transaction.commit();
    }

    if (profiles.length > 0) {
      await task.enqueueIn(config.tasks.timeout + 1, "run:internalRun", {
        runGuid: run.guid,
        offset: offset + limit,
        limit,
      });
    } else {
      await task.enqueueIn(config.tasks.timeout + 1, "run:determineState", {
        runGuid: run.guid,
      });
    }
  }
}
