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
    .cloud.domain.root.set(process.env.ROOT_DOMAIN || "pom.ac");
  await config
    .cloud.domain.generated.set(process.env.GENERATED_DOMAIN || "g.pom.ac");

  try {
    await config.cloud.domain.validation.keys.data.privateKey.get();
  } catch {
    await config.cloud.domain.validation.generate();
  }

  try {
    await config.cloud.p2p.swarm.key.data.get();
  } catch {
    await config.cloud.p2p.swarm.generate();
  }

  // using SSH key for authentication
  const mainAuth = config.auth.signer["main"];
  await mainAuth.username.set(process.env.SSH_USER || "ssh-user");
  const sshkey = await fs.promises.readFile(process.env.SSH_KEY || "ssh-key.pem");
  await mainAuth.key.path.set("keys/ssh-key.pem");
  await mainAuth.key.data.set(sshkey);

  const all = config.shapes.get("all");
  await all
    .services
    .set(["auth", "tns", "hoarder", "seer", "substrate", "patrick", "monkey"]);
  await all.ports.port["main"].set(4242);
  await all.ports.port["lite"].set(4262);

  const hosts = await config.hosts.list();
  const bootstrapers = [];

  for (const server of getServersFromCSV()) {
    const { hostname, publicIp } = server;
    if (!hosts.includes(hostname)) {
      const host = config.hosts.get(hostname);
      bootstrapers.push(hostname);

      await host.addresses.add([`${publicIp}/32`]);
      await host.ssh.address.set(`${publicIp}:22`);
      await host.ssh.auth.add(["main"]);
      await host.location.set("40.730610, -73.935242");
      if (!(await host.shapes.list()).includes("all"))
        await host.shapes.get("all").generate();
    }
  }

  await config.cloud.p2p.bootstrap.shape["all"].nodes.add(bootstrapers);

  await config.commit();
};

function extractIpFromCidr(cidr: string): string {
  return cidr.split("/")[0];
}

export const fixDNS = async (config: Config): Promise<boolean> => {
  const apiUser = process.env.NAMECHEAP_USERNAME;
  const apiKey = process.env.NAMECHEAP_API_KEY;
  const clientIp = process.env.NAMECHEAP_IP;
  const rootDomain = process.env.ROOT_DOMAIN || "pom.ac";
  const generatedDomain = process.env.GENERATED_DOMAIN || `g.${rootDomain}`;

  // Extract the prefix of GENERATED_DOMAIN relative to ROOT_DOMAIN (e.g., "g" in "g.example.com")
  const generatedPrefix = generatedDomain.endsWith(`.${rootDomain}`)
    ? generatedDomain.slice(0, generatedDomain.length - rootDomain.length - 1)
    : generatedDomain;

  if (!apiUser && !apiKey && !clientIp) {
    return false; // skip
  } else if (!apiUser || !apiKey || !clientIp) {
    throw new Error(
      "Environment variables NAMECHEAP_USERNAME, NAMECHEAP_API_KEY, and NAMECHEAP_IP must be set"
    );
  }

  const seerAddrs = [];
  for (const hostname of await config.hosts.list()) {
    if ((await config.hosts.get(hostname).shapes.list()).includes("all")) {
      for (const addr of await config
        .hosts.get(hostname).addresses.list()) {
        seerAddrs.push(extractIpFromCidr(addr));
      }
    }
  }

  const client = new NamecheapDnsClient(
    apiUser,
    apiKey,
    clientIp,
    rootDomain,
    false
  );

  await client.init();

  client.setAll("seer", "A", seerAddrs);

  client.setAll("tau", "NS", [
    `seer.${rootDomain}.`,
  ]);

  // Wildcard CNAME for generated domain (e.g., *.g -> substrate.tau.rootDomain)
  client.setAll(`*.${generatedPrefix}`, "CNAME", [
    `substrate.tau.${rootDomain}.`,
  ]);

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
