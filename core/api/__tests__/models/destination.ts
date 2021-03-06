import { helper } from "../utils/specHelper";
import { specHelper } from "actionhero";
import { App } from "../../src/models/App";
import { Log } from "../../src/models/Log";
import { Destination } from "../../src/models/Destination";
import { Group } from "../../src/models/Group";
import { Export } from "../../src/models/Export";
import { Mapping } from "../../src/models/Mapping";
import { Option } from "../../src/models/Option";
import { DestinationGroupMembership } from "../../src/models/DestinationGroupMembership";
import { plugin } from "../../src/modules/plugin";
import { DestinationGroup } from "../../src/models/DestinationGroup";
let actionhero;
let api;

describe("models/destination", () => {
  beforeAll(async () => {
    const env = await helper.prepareForAPITest();
    actionhero = env.actionhero;
    api = env.api;
  }, 1000 * 30);

  afterAll(async () => {
    await helper.shutdown(actionhero);
  });

  beforeAll(async () => {
    await helper.factories.profilePropertyRules();
  });

  describe("with apps", () => {
    let app: App;
    let destination: Destination;

    beforeAll(async () => {
      app = await helper.factories.app();
    });

    afterEach(async () => {
      if (destination) {
        await destination.destroy();
      }
    });

    test("a destination can be created, and it can find the related app", async () => {
      destination = await Destination.create({
        name: "test destination",
        type: "test-plugin-export",
        appGuid: app.guid,
      });

      expect(destination.guid.length).toBe(40);
      expect(destination.createdAt).toBeTruthy();
      expect(destination.updatedAt).toBeTruthy();

      const options = await destination.getOptions();
      expect(options).toEqual({});

      const _app = await destination.$get("app");
      expect(_app.guid).toBe(app.guid);
    });

    test("a new destination will have a '' name", async () => {
      destination = await Destination.create({
        type: "test-plugin-export",
        appGuid: app.guid,
      });

      expect(destination.name).toBe("");

      await destination.destroy();
    });

    test("draft destination can share the same name, but not with ready destination", async () => {
      const destinationOne = await Destination.create({
        type: "test-plugin-export",
        appGuid: app.guid,
      });

      const otherApp = await helper.factories.app();
      const destinationTwo = await Destination.create({
        type: "test-plugin-export",
        appGuid: otherApp.guid,
      });

      expect(destinationOne.name).toBe("");
      expect(destinationTwo.name).toBe("");

      await destinationOne.update({ name: "name" });
      await destinationOne.setOptions({ table: "abc123" });
      await destinationOne.update({ state: "ready" });

      await expect(destinationTwo.update({ name: "name" })).rejects.toThrow(
        /name "name" is already in use/
      );

      await destinationOne.destroy();
      await destinationTwo.destroy();
      await otherApp.destroy();
    });

    test("creating a destination creates a log entry", async () => {
      const latestLog = await Log.findOne({
        where: { verb: "create", topic: "destination" },
        order: [["createdAt", "desc"]],
        limit: 1,
      });

      expect(latestLog).toBeTruthy();
    });

    test("a destination tracking a group cannot be deleted", async () => {
      const group = await helper.factories.group();
      destination = await Destination.create({
        name: "bye destination",
        type: "test-plugin-export",
        appGuid: app.guid,
      });
      await destination.trackGroup(group);
      await expect(destination.destroy()).rejects.toThrow(
        /cannot delete a destination that is tracking a group/
      );

      await group.destroy();
      await destination.destroy();
    });

    test("a destination tracking all groups cannot be deleted", async () => {
      const group = await helper.factories.group();
      destination = await Destination.create({
        name: "bye destination",
        type: "test-plugin-export",
        appGuid: app.guid,
      });
      await destination.update({ trackAllGroups: true });
      await expect(destination.destroy()).rejects.toThrow(
        /cannot delete a destination that is tracking a group/
      );

      await group.destroy();

      await expect(destination.destroy()).rejects.toThrow(
        /cannot delete a destination that is tracking a group/
      );

      await destination.update({ trackAllGroups: false });
      await destination.destroy(); // does not throw
    });

    test("deleting a destination deletes related models", async () => {
      const group = await helper.factories.group();
      destination = await Destination.create({
        name: "bye destination",
        type: "test-plugin-export",
        appGuid: app.guid,
      });

      await destination.setOptions({ table: "table" });
      await destination.setMapping({ "primary-id": "userId" });
      await destination.trackGroup(group);
      const destinationGroupMemberships = {};
      destinationGroupMemberships[group.guid] = "remote-tag";
      await destination.setDestinationGroupMemberships(
        destinationGroupMemberships
      );

      await destination.unTrackGroups();
      await destination.destroy();

      let count = await DestinationGroupMembership.count({
        where: { destinationGuid: destination.guid },
      });
      expect(count).toBe(0);
      count = await Option.count({
        where: { ownerGuid: destination.guid },
      });
      expect(count).toBe(0);
      count = await Mapping.count({
        where: { ownerGuid: destination.guid },
      });
      expect(count).toBe(0);
      count = await DestinationGroup.count({
        where: { destinationGuid: destination.guid },
      });
      expect(count).toBe(0);

      await group.destroy();
    });

    test("deleting a destination creates a log entry and enqueued a destroyExports task", async () => {
      destination = await Destination.create({
        name: "bye destination",
        type: "test-plugin-export",
        appGuid: app.guid,
      });

      await destination.destroy();

      const latestLog = await Log.findOne({
        where: { verb: "create", topic: "destination" },
        order: [["createdAt", "desc"]],
        limit: 1,
      });

      expect(latestLog).toBeTruthy();

      const foundTasks = await specHelper.findEnqueuedTasks(
        "destination:destroyExports"
      );
      expect(foundTasks.length).toBeGreaterThanOrEqual(1);
      expect(foundTasks[foundTasks.length - 1].args[0]).toEqual({
        destinationGuid: destination.guid,
      });
    });

    test("a destination can get options from a connection", async () => {
      const options = await destination.destinationConnectionOptions();
      expect(options).toEqual({
        table: { type: "list", options: ["users_out"] },
      });
    });

    describe("validations", () => {
      test("options must match the app options (extra options needed by connection)", async () => {
        destination = new Destination({
          name: "incoming destination - too many options",
          type: "test-plugin-export",
          appGuid: app.guid,
        });
        await destination.save();
        expect(destination.guid).toBeTruthy();

        await expect(
          destination.setOptions({
            something: "abc123",
            table: "abc",
            primaryKey: "userID",
            groupsTable: "groups",
            groupForeignKey: "userId",
            groupColumnName: "groupName",
          })
        ).rejects.toThrow(
          /something is not an option for a test-plugin-export destination/
        );
      });

      test("required mappings must be included in the mappings", async () => {
        destination = await helper.factories.destination();
        await expect(
          destination.setMapping({
            local_first_name: "firstName",
          })
        ).rejects.toThrow(/primary-id is a required/);
      });

      test("required mappings with a type can only use profile properties that match the type", async () => {
        destination = await helper.factories.destination();
        await expect(
          destination.setMapping({
            "primary-id": "email",
          })
        ).rejects.toThrow(
          /primary-id requires a profile property rule of type integer/
        );
      });

      test("mappings must map to profilePropertyRules", async () => {
        destination = await helper.factories.destination();
        await destination.setMapping({
          "primary-id": "userId",
          local_first_name: "firstName",
        });
        const mapping = await destination.getMapping();
        expect(mapping).toEqual({
          "primary-id": "userId",
          local_first_name: "firstName",
        });
      });

      test("it throws an error if the mapping does not include the key of a profilePropertyRyle", async () => {
        destination = await helper.factories.destination();
        await expect(
          destination.setMapping({
            "primary-id": "TheUserID",
          })
        ).rejects.toThrow(/cannot find profile property rule TheUserID/);
      });

      test("a destination cannot be created in the ready state with missing required options", async () => {
        const destination = Destination.build({
          appGuid: app.guid,
          type: "test-plugin-export",
          state: "ready",
        });

        await expect(destination.save()).rejects.toThrow(/table is required/);
      });

      test("a destination cannot be changed to to the ready state if there are missing required options", async () => {
        destination = await Destination.build({
          appGuid: app.guid,
          name: "missing options",
          type: "test-plugin-export",
        });
        await expect(destination.update({ state: "ready" })).rejects.toThrow();
      });

      test("a destination that is ready cannot move back to draft", async () => {
        destination = await helper.factories.destination();
        await destination.setOptions({ table: "users" });
        await destination.update({ state: "ready" });

        await expect(destination.update({ state: "draft" })).rejects.toThrow(
          /cannot transition destination state from ready to draft/
        );
      });

      test("an app can only have one destination", async () => {
        destination = await Destination.create({
          name: "first destination",
          appGuid: app.guid,
          type: "test-plugin-export",
        });

        await expect(
          Destination.create({
            name: "second destination",
            appGuid: app.guid,
            type: "test-plugin-export",
          })
        ).rejects.toThrow(
          /destination "first destination" is already using this app/
        );
      });
    });

    describe("with groups", () => {
      let destination: Destination;
      let group: Group;

      beforeEach(async () => {
        destination = await Destination.create({
          name: "test destination",
          appGuid: app.guid,
          type: "test-plugin-export",
        });

        group = await helper.factories.group();
      });

      afterEach(async () => {
        await group.destroy();
        await destination.update({ trackAllGroups: false });
        await destination.destroy();
      });

      test("a group can be tracked", async () => {
        await destination.trackGroup(group);
        const groups = await destination.$get("groups");
        expect(groups.length).toBe(1);
        expect(groups[0].guid).toBe(group.guid);
      });

      test("a group cannot be added twice", async () => {
        await destination.trackGroup(group);
        await destination.trackGroup(group);
        const groups = await destination.$get("groups");
        expect(groups.length).toBe(1);
      });

      test("a destination can only track a single group", async () => {
        const newGroup = await helper.factories.group();

        await destination.trackGroup(group);
        await destination.trackGroup(newGroup);
        const groups = await destination.$get("groups");
        expect(groups.length).toBe(1);
        expect(groups[0].guid).toBe(newGroup.guid);
        await newGroup.destroy();
      });

      test("a group can be unTracked", async () => {
        await destination.trackGroup(group);
        let groups = await destination.$get("groups");
        expect(groups.length).toBe(1);

        await destination.unTrackGroups();
        groups = await destination.$get("groups");
        expect(groups.length).toBe(0);
      });

      test("if the destination mapping changes, a group#run task will be enqueued", async () => {
        await api.resque.queue.connection.redis.flushdb();

        await destination.trackGroup(group);
        let foundTasks = await specHelper.findEnqueuedTasks("group:run");
        expect(foundTasks.length).toBe(1);

        await api.resque.queue.connection.redis.flushdb();
        await destination.setMapping({
          "primary-id": "userId",
          local_first_name_: "firstName",
        });

        foundTasks = await specHelper.findEnqueuedTasks("group:run");
        expect(foundTasks.length).toBe(1);
      });

      test("profilePreview - without updates - with group", async () => {
        const profile = await helper.factories.profile();
        await profile.addOrUpdateProperties({
          userId: 1,
          email: "yoshi@example.com",
        });
        await group.addProfile(profile);
        await destination.trackGroup(group);

        const mapping = {
          "primary-id": "userId",
          email: "email",
        };

        const destinationGroupMemberships = {};
        destinationGroupMemberships[group.guid] = "another-group-tag";

        const _profile = await destination.profilePreview(
          profile,
          mapping,
          destinationGroupMemberships
        );
        expect(_profile.properties["primary-id"].value).toBe(1);
        expect(_profile.properties["email"].value).toBe("yoshi@example.com");
        expect(_profile.groupNames).toEqual(["another-group-tag"]);

        await profile.destroy();
      });

      test("previewing a profile not in any groups tracked by this destination will throw", async () => {
        const profile = await helper.factories.profile();

        const mapping = {
          "primary-id": "userId",
          email: "email",
        };

        const destinationGroupMemberships = {};
        destinationGroupMemberships[group.guid] = "another-group-tag";

        await expect(
          destination.profilePreview(
            profile,
            mapping,
            destinationGroupMemberships
          )
        ).rejects.toThrow(/will not be exported by this profile/);
        await profile.destroy();
      });

      describe("trackAllGroups", () => {
        test("no groups can be added or removed if the destination is tracking all groups", async () => {
          await destination.update({ trackAllGroups: true });
          await expect(destination.trackGroup(group)).rejects.toThrow(
            /destination is tracking all groups/
          );
          await expect(destination.unTrackGroups()).rejects.toThrow(
            /destination is tracking all groups/
          );
        });

        test("adding a new destination that tracks all groups will build a destinationGroup for all groups", async () => {
          let destinationGroups = await group.$get("destinationGroups");
          expect(destinationGroups.length).toBe(0);

          await destination.update({ trackAllGroups: true });

          destinationGroups = await group.$get("destinationGroups");
          expect(destinationGroups.length).toBe(1);
          expect(destinationGroups[0].destinationGuid).toBe(destination.guid);
        });

        test("removing trackAllGroups from a destination will remove all destinationGroups", async () => {
          await destination.update({ trackAllGroups: true });
          let destinationGroups = await group.$get("destinationGroups");
          expect(destinationGroups.length).toBe(1);

          await destination.update({ trackAllGroups: false });
          await destination.destroy();

          destinationGroups = await group.$get("destinationGroups");
          expect(destinationGroups.length).toBe(0);
        });
      });

      describe("destinationsForGroups", () => {
        it("determined relevant destinations for a profile", async () => {
          await destination.trackGroup(group);
          const otherDestination = await helper.factories.destination();
          const profile = await helper.factories.profile();
          await group.addProfile(profile);

          // before the destinations are ready
          let destinations = await Destination.destinationsForGroups(
            await profile.$get("groups")
          );
          expect(destinations.length).toBe(0);

          // after the destinations are ready
          await destination.setOptions({ table: "some table" });
          await destination.update({ state: "ready" });
          await otherDestination.setOptions({ table: "some table" });
          await otherDestination.update({ state: "ready" });

          destinations = await Destination.destinationsForGroups(
            await profile.$get("groups")
          );
          expect(destinations.length).toBe(1);
          expect(destinations[0].guid).toBe(destination.guid);

          await destination.unTrackGroups();
          await group.removeProfile(profile);
        });

        test("when the group being tracked is removed, the previous group should be exported one last time", async () => {
          await api.resque.queue.connection.redis.flushdb();

          await destination.trackGroup(group);
          let foundTasks = await specHelper.findEnqueuedTasks("group:run");
          expect(foundTasks.length).toBe(1);
          expect(foundTasks[0].args[0]).toEqual({
            force: true,
            destinationGuid: destination.guid,
            groupGuid: group.guid,
          });

          await api.resque.queue.connection.redis.flushdb();
          await destination.unTrackGroups();
          foundTasks = await specHelper.findEnqueuedTasks("group:run");
          expect(foundTasks.length).toBe(1);
          expect(foundTasks[0].args[0]).toEqual({
            force: true,
            destinationGuid: destination.guid,
            groupGuid: group.guid,
          });
        });

        test("when the group being tracked is changed, the previous group should be exported one last time", async () => {
          const otherGroup = await helper.factories.group();
          await otherGroup.update({ state: "ready" });
          await destination.trackGroup(group);
          await api.resque.queue.connection.redis.flushdb();

          await destination.trackGroup(otherGroup);

          let foundTasks = await specHelper.findEnqueuedTasks("group:run");
          expect(foundTasks.length).toBe(2);
          expect(foundTasks[0].args[0]).toEqual({
            force: true,
            destinationGuid: destination.guid,
            groupGuid: group.guid,
          });
          expect(foundTasks[1].args[0]).toEqual({
            force: true,
            destinationGuid: destination.guid,
            groupGuid: otherGroup.guid,
          });

          await otherGroup.destroy();
        });

        it("informs all destinations if trackAllGroups is set", async () => {
          await destination.update({ trackAllGroups: true });

          const otherApp = await helper.factories.app();
          const otherDestination = await Destination.create({
            name: "other destination",
            appGuid: otherApp.guid,
            type: "test-plugin-export",
          });
          await otherDestination.update({ trackAllGroups: true });

          const profile = await helper.factories.profile();
          await group.addProfile(profile);

          // before the destinations are ready
          let destinations = await Destination.destinationsForGroups(
            await profile.$get("groups")
          );
          expect(destinations.length).toEqual(0);

          // after the destinations are ready
          await destination.setOptions({ table: "some table" });
          await destination.update({ state: "ready" });
          await otherDestination.setOptions({ table: "some table" });
          await otherDestination.update({ state: "ready" });

          destinations = await Destination.destinationsForGroups(
            await profile.$get("groups")
          );
          expect(destinations.length).toEqual(2);

          await otherDestination.update({ trackAllGroups: false });
          await otherDestination.destroy();
          await otherApp.destroy();
          await group.removeProfile(profile);
        });
      });
    });

    describe("parameterizedOptions", () => {
      it("replaces mustache template strings with variables", async () => {
        destination = new Destination({
          name: "outgoing pg destination",
          type: "test-plugin-export",
          appGuid: app.guid,
        });
        await destination.save();

        await destination.setOptions({
          table: "thing-{{ now.sql }}",
        });

        const parameterizedOptions = await destination.parameterizedOptions();
        const now = new Date();
        expect(parameterizedOptions.table).toMatch(
          `thing-${now.getFullYear()}`
        );
      });
    });
  });

  describe("with a connection that cannot export", () => {
    let app: App;
    let exportArgs = {
      app: null,
      options: null,
      profile: null,
      oldProfileProperties: null,
      newProfileProperties: null,
      oldGroups: null,
      newGroups: null,
    };

    beforeAll(async () => {
      plugin.registerPlugin({
        name: "test-import-only-plugin",
        apps: [
          {
            name: "test-template-app",
            options: [],
            methods: {
              test: async () => {
                return true;
              },
            },
          },
        ],
        connections: [
          {
            name: "import-from-test-template-app",
            description: "a test app connection",
            app: "test-template-app",
            direction: "export",
            options: [],
            methods: {},
          },
        ],
      });

      app = await App.create({
        name: "test app with temp methods",
        type: "test-template-app",
      });
      await app.update({ state: "ready" });
    });

    afterAll(async () => {
      await app.destroy();
    });

    test("you are prevented from making a destination against an app with no export methods", async () => {
      await expect(
        Destination.create({
          name: "test plugin destination app missing methods",
          type: "import-from-test-template-app",
          appGuid: app.guid,
        })
      ).rejects.toThrow(
        /cannot be created as there is no exportProfile method/
      );
    });
  });

  describe("with custom plugin", () => {
    let app: App;
    let exportArgs = {
      app: null,
      appOptions: null,
      destination: null,
      destinationOptions: null,
      profile: null,
      oldProfileProperties: null,
      newProfileProperties: null,
      oldGroups: null,
      newGroups: null,
      toDelete: null,
    };

    beforeEach(() => {
      exportArgs = {
        app: null,
        appOptions: null,
        destination: null,
        destinationOptions: null,
        profile: null,
        oldProfileProperties: null,
        newProfileProperties: null,
        oldGroups: null,
        newGroups: null,
        toDelete: null,
      };
    });

    beforeAll(async () => {
      plugin.registerPlugin({
        name: "test-plugin",
        apps: [
          {
            name: "test-template-app",
            options: [{ key: "test_key", required: true }],
            methods: {
              test: async () => {
                return true;
              },
            },
          },
        ],
        connections: [
          {
            name: "export-from-test-template-app",
            description: "a test app connection",
            app: "test-template-app",
            direction: "export",
            options: [],
            methods: {
              destinationMappingOptions: async () => {
                return {
                  labels: {
                    group: {
                      singular: "list",
                      plural: "lists",
                    },
                    profilePropertyRule: {
                      singular: "var",
                      plural: "vars",
                    },
                  },
                  profilePropertyRules: {
                    required: [],
                    known: [],
                    allowOptionalFromProfilePropertyRules: true,
                  },
                };
              },
              exportProfile: async ({
                app,
                appOptions,
                destination,
                destinationOptions,
                profile,
                oldProfileProperties,
                newProfileProperties,
                oldGroups,
                newGroups,
                toDelete,
              }) => {
                exportArgs = {
                  app,
                  appOptions,
                  destination,
                  destinationOptions,
                  profile,
                  oldProfileProperties,
                  newProfileProperties,
                  oldGroups,
                  newGroups,
                  toDelete,
                };
                return true;
              },
            },
          },
        ],
      });

      app = await App.create({
        name: "test with real methods",
        type: "test-template-app",
      });
      await app.setOptions({ test_key: "abc" });
      await app.update({ state: "ready" });
    });

    test("the app exportProfiles method can be called by the destination and exports will be created and mappings followed", async () => {
      await app.setOptions({
        test_key: "abc123",
      });

      const destination = await Destination.create({
        name: "test plugin destination",
        type: "export-from-test-template-app",
        appGuid: app.guid,
      });

      await destination.setMapping({
        uid: "userId",
        customer_email: "email",
      });

      const groupA = await helper.factories.group();
      const groupB = await helper.factories.group();

      await destination.trackGroup(groupA);

      const destinationGroupMemberships = {};
      // modify the membership name
      destinationGroupMemberships[groupA.guid] = groupA.name + "+";
      destinationGroupMemberships[groupB.guid] = groupB.name + "+";
      await destination.setDestinationGroupMemberships(
        destinationGroupMemberships
      );

      const profile = await helper.factories.profile();
      const oldProfileProperties = { email: "oldEmail" };
      const newProfileProperties = { email: "newEmail" };
      const oldGroups = [];
      const newGroups = [groupA, groupB];

      const _import = await helper.factories.import();

      const response = await destination.exportProfile(
        profile,
        [_import],
        oldProfileProperties,
        newProfileProperties,
        oldGroups,
        newGroups
      );

      expect(response).toEqual(true);
      expect(exportArgs.destination.guid).toEqual(destination.guid);
      expect(exportArgs.app.guid).toEqual(app.guid);
      expect(exportArgs.profile.guid).toEqual(profile.guid);
      expect(exportArgs.oldProfileProperties).toEqual({
        customer_email: "oldEmail",
      });
      expect(exportArgs.newProfileProperties).toEqual({
        customer_email: "newEmail",
      });
      expect(exportArgs.oldGroups).toEqual([]);
      expect(exportArgs.newGroups).toEqual(
        newGroups.map((g) => `${g.name}+`).sort()
      );
      expect(exportArgs.toDelete).toEqual(false);

      const _exports = await Export.findAll({
        where: { destinationGuid: destination.guid },
      });
      expect(_exports.length).toBe(1);
      expect(_exports[0].destinationGuid).toBe(destination.guid);
      expect(_exports[0].profileGuid).toBe(profile.guid);
      expect(
        _exports[0].completedAt.getTime() - _exports[0].startedAt.getTime()
      ).toBeGreaterThan(0);
      expect(_exports[0].errorMessage).toBeFalsy();
      expect(_exports[0].oldProfileProperties).toEqual({
        customer_email: "oldEmail",
      });
      expect(_exports[0].newProfileProperties).toEqual({
        customer_email: "newEmail",
      });
      expect(_exports[0].oldGroups).toEqual([]);
      expect(_exports[0].newGroups).toEqual(
        newGroups.map((g) => `${g.name}+`).sort()
      );
      expect(_exports[0].mostRecent).toBe(true);

      const exportedImports = await _exports[0].$get("imports");
      expect(exportedImports.length).toBe(1);
      expect(exportedImports[0].guid).toBe(_import.guid);

      await destination.unTrackGroups();
      await destination.destroy();
    });

    test("if a profile is removed from all groups tracked by this destination, toDelete is true", async () => {
      await app.setOptions({
        test_key: "abc123",
      });

      const destination = await Destination.create({
        name: "test plugin destination",
        type: "export-from-test-template-app",
        appGuid: app.guid,
      });

      await destination.setMapping({
        uid: "userId",
        customer_email: "email",
      });

      const groupA = await helper.factories.group();
      const groupB = await helper.factories.group();

      const destinationGroupMemberships = {};
      destinationGroupMemberships[groupA.guid] = groupA.name;
      destinationGroupMemberships[groupB.guid] = groupB.name;
      await destination.setDestinationGroupMemberships(
        destinationGroupMemberships
      );

      const profile = await helper.factories.profile();
      const oldProfileProperties = { email: "oldEmail" };
      const newProfileProperties = { email: "newEmail" };
      const oldGroups = [groupA, groupB];
      const newGroups = [];

      const _import = await helper.factories.import();

      const response = await destination.exportProfile(
        profile,
        [_import],
        oldProfileProperties,
        newProfileProperties,
        oldGroups,
        newGroups
      );

      expect(response).toBe(true);
      expect(exportArgs.profile.guid).toEqual(profile.guid);
      expect(exportArgs.oldGroups).toEqual(oldGroups.map((g) => g.name).sort());
      expect(exportArgs.newGroups).toEqual([]);
      expect(exportArgs.toDelete).toEqual(true);

      await destination.destroy();
    });
  });
});
