import {
  Config,
  CourseConfig,
  Drive,
  TauLatest,
  TauPath,
  Course,
} from "@taubyte/spore-drive";
import fs from "fs";
import dotenv from "dotenv";

// Load .env file at the start
dotenv.config();

import { getServersFromCSV } from "./csv";
import NamecheapDnsClient from "./namecheap";

import { fileURLToPath } from "url";
import path from "path";

import { existsSync, mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { ProgressBar } from "@opentf/cli-pbar";

function extractHost(path: string): string {
  const match = path.match(/\/([^\/]+):\d+/);
  return match ? match[1] : "unknown-host";
}

function extractTask(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || "unknown-task";
}

async function displayProgress(course: Course) {
  const multiPBar = new ProgressBar({ size: "SMALL" });
  multiPBar.start();
  const taskBars: Record<string, any> = {};
  const errors: { host: string; task: string; error: string }[] = [];

  for await (const displacement of await course.progress()) {
    const host = extractHost(displacement.path);
    const task = extractTask(displacement.path);

    if (!taskBars[host]) {
      taskBars[host] = multiPBar.add({
        prefix: host,
        suffix: "...",
        total: 100,
      });
    }

    taskBars[host].update({ value: displacement.progress, suffix: task });

    if (displacement.error) {
      errors.push({ host, task, error: displacement.error });
    }
  }

  for (const host in taskBars) {
    const errorForHost = errors.find((err) => err.host === host);

    if (errorForHost) {
      taskBars[host].update({ value: 100, color: "r", suffix: "failed" });
    } else {
      taskBars[host].update({ value: 100, suffix: "succesful" });
    }
  }

  multiPBar.stop();

  if (errors.length > 0) {
    console.log("\nErrors encountered:");
    errors.forEach((err) => {
      console.log(`Host: ${err.host}, Task: ${err.task}, Error: ${err.error}`);
    });
    throw new Error("displacement failed");
  }
}

export const createConfig = async (config: Config) => {
  await config
    .Cloud()
    .Domain()
    .Root()
    .Set(process.env.ROOT_DOMAIN || "pom.ac");
  await config
    .Cloud()
    .Domain()
    .Generated()
    .Set(process.env.GENERATED_DOMAIN || "g.pom.ac");

  try {
    await config.Cloud().Domain().Validation().Keys().Data().PrivateKey().Get();
  } catch {
    await config.Cloud().Domain().Validation().Generate();
  }

  try {
    await config.Cloud().P2P().Swarm().Key().Data().Get();
  } catch {
    await config.Cloud().P2P().Swarm().Generate();
  }

  // using SSH key for authentication
  const mainAuth = config.Auth().Signer("main");
  await mainAuth.Username().Set(process.env.CATO_USER || "cato-user");
  const sshkey = await fs.promises.readFile(process.env.SSH_KEY || "cato.pem");
  await mainAuth.Key().Path().Set("keys/cato.pem");
  await mainAuth.Key().Data().Set(sshkey);

  const all = config.Shapes().Shape("all");
  await all
    .Services()
    .Set(["auth", "tns", "hoarder", "seer", "substrate", "patrick", "monkey"]);
  await all.Ports().Port("main").Set(BigInt(4242));
  await all.Ports().Port("lite").Set(BigInt(4262));

  const hosts = await config.Hosts().List();
  const bootstrapers = [];

  for (const server of getServersFromCSV()) {
    const { hostname, publicIp } = server;
    if (!hosts.includes(hostname)) {
      const host = config.Hosts().Host(hostname);
      bootstrapers.push(hostname);

      await host.Addresses().Add([`${publicIp}/32`]);
      await host.SSH().Address().Set(`${publicIp}:22`);
      await host.SSH().Auth().Add(["main"]);
      await host.Location().Set("40.730610, -73.935242");
      if (!(await host.Shapes().List()).includes("all"))
        await host.Shapes().Shape("all").Instance().Generate();
    }
  }

  await config.Cloud().P2P().Bootstrap().Shape("all").Nodes().Add(bootstrapers);

  await config.Commit();
};

function extractIpFromCidr(cidr: string): string {
  return cidr.split("/")[0];
}

export const fixDNS = async (config: Config): Promise<boolean> => {
  const apiUser = process.env.NAMECHEAP_USERNAME;
  const apiKey = process.env.NAMECHEAP_API_KEY;
  const clientIp = process.env.NAMECHEAP_IP;
  const domain = "pom.ac";

  if (!apiUser && !apiKey && !clientIp) {
    return false; // skip
  } else if (!apiUser || !apiKey || !clientIp) {
    throw new Error(
      "Environment variables NAMECHEAP_USERNAME, NAMECHEAP_API_KEY, and NAMECHEAP_IP must be set"
    );
  }

  const seerAddrs = [];
  for (const hostname of await config.Hosts().List()) {
    if ((await config.Hosts().Host(hostname).Shapes().List()).includes("all")) {
      for (const addr of await config
        .Hosts()
        .Host(hostname)
        .Addresses()
        .List()) {
        seerAddrs.push(extractIpFromCidr(addr));
      }
    }
  }

  const client = new NamecheapDnsClient(
    apiUser,
    apiKey,
    clientIp,
    domain,
    false
  );

  await client.init();

  client.setAll("seer", "A", seerAddrs);

  client.setAll("tau", "NS", ["seer.pom.ac."]);

  client.setAll("*.g", "CNAME", ["substrate.tau.pom.ac."]);

  await client.commit();

  return true;
};

const configPath = `${__dirname}/../config`;

// Ensure config directory exists
if (!existsSync(configPath)) {
  mkdirSync(configPath, { recursive: true });
}

const config: Config = new Config(configPath);

await config.init();

await createConfig(config);

// Use TauPath("path/to/tau") if you'd like to deploy your own build of tau
const drive: Drive = new Drive(config, TauLatest);

await drive.init();

const course = await drive.plot(new CourseConfig(["all"]));

console.log("Displacement...");
try {
  await course.displace();
  await displayProgress(course);
  console.log("[Done] Displacement");
} catch (e) {
  console.log("Error displacing course:", e);
  process.exit(1);
}

console.log("Update DNS Records...");
try {
  if (await fixDNS(config)) console.log("[Done] DNS Records");
  else console.log("[Skip] DNS Records");
} catch (e) {
  console.log("Error updating DNS records:", e);
  process.exit(2);
}
