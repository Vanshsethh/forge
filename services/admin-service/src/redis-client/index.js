const Redis = require("ioredis");

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: 6379,
});

async function setFleetKill(on) {
  if (on) await redis.set("kill:global", "1");
  else await redis.del("kill:global");
}

async function setAgentRevoked(agentId, on) {
  if (on) await redis.set(`kill:agent:${agentId}`, "1");
  else await redis.del(`kill:agent:${agentId}`);
}

async function isFleetKilled() {
  return (await redis.get("kill:global")) === "1";
}

module.exports = { redis, setFleetKill, setAgentRevoked, isFleetKilled };
