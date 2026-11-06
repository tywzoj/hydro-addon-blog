require("hydrooj/bin/hydrooj");

global.app.inject(["storage"], (ctx) =>
    ctx.on("app/ready", async () => {
        try {
            const { DomainModel, PRIV, SystemModel, UserModel } = require("hydrooj");
            const { accounts } = require("../tests/e2e/accounts.ts");
            const storage = await ctx.storage.status();
            if (!storage.status || storage.dir !== process.env.DEFAULT_STORE_PATH) {
                throw new Error("Hydro did not use the isolated DEFAULT_STORE_PATH");
            }
            if (!global.Hydro.model.blog) throw new Error("The blog addon did not load");
            await SystemModel.set("server.url", process.env.HYDRO_E2E_URL);
            await SystemModel.set("pagination.reply", 3);
            await UserModel.setById(0, { viewLang: "en" });
            for (const [role, account] of Object.entries(accounts)) {
                const privilege = PRIV.PRIV_USER_PROFILE | (role === "editor" ? PRIV.PRIV_EDIT_SYSTEM : 0);
                await UserModel.create(
                    `${account.name}@example.invalid`,
                    account.name,
                    account.password,
                    account.id,
                    "127.0.0.1",
                    privilege,
                );
                await UserModel.setById(account.id, { viewLang: "en", preferredEditorType: "sv" });
            }
            await DomainModel.add("blogrestricted", 2, "Blog isolation fixture", "");
            await DomainModel.setRoles("blogrestricted", { guest: 0n, default: 0n });
            process.send?.({ type: "hydro-e2e-ready", storage: storage.dir });
        } catch (error) {
            console.error(error);
            process.send?.({ type: "hydro-e2e-error", message: error.message });
            process.exit(1);
        }
    }),
);
