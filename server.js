const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");
const fs = require("fs");
const crypto = require("crypto");
const readline = require("readline");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ACCOUNTS_FILE = "accounts.json";

app.use(express.static("public"));
app.use(express.json());

function loadAccounts() {
  try {
    const raw = fs.readFileSync(ACCOUNTS_FILE, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAccounts(accounts) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function scheduleAccountsSave() {
  if (accountSaveTimer) {
    return;
  }

  accountSaveTimer = setTimeout(() => {
    accountSaveTimer = null;
    saveAccounts(accounts);
  }, 5000);
}

function savePlayerAccount(player) {
  const account = accounts[player.name];
  if (!account) {
    return;
  }

  Object.assign(account, {
    score: player.score,
    damage: player.damage,
    maxHp: player.maxHp,
    speed: player.speed,
    crossbow: player.crossbow,
    arrows: player.arrows,
    shieldRemainingMs: player.shieldRemainingMs,
    trollcmds: player.trollcmds,
    gameClass: player.gameClass,
  });
  saveAccounts(accounts);
}

const accounts = loadAccounts();
const sessions = {};
const players = {};
const coins = {};
const powerUps = {};
const rareCoins = {};
const enemies = {};
const pendingPlayerMoves = new Map();
const lastTrollCommandAt = new Map();
const arenaQueue = new Set();
let accountSaveTimer = null;
const ARENA_MIN_PLAYERS = 4;
const ARENA_MAX_PLAYERS = 8;
const ARENA_READY_DELAY_MS = 10000;
let arenaStartTimer = null;
let activeArena = null;
const worldWidth = 2000;
const worldHeight = 1100;
const playerClasses = ["Fighter", "Runner", "Tank", "Collector"];
const capturePoint = { x: 1000, y: 550, ownerId: null, progressMs: 0, rewardElapsedMs: 0 };
let dynamicZone = null;
let weather = { type: null, until: 0 };
let nextZoneAt = Date.now() + 30000;
let nextWeatherAt = Date.now() + 60000;
let nextRareCoinAt = Date.now() + 20000;
let nextPowerUpAt = Date.now() + 5000;
let nextEnemyAt = Date.now() + 12000;
let nextChaosEffectAt = Date.now() + 2000;
const lastPlayerZoneTick = new Map();
const teleportGates = [
  { id: "gate-1", x: 250, y: 250, destination: 1 },
  { id: "gate-2", x: 1750, y: 250, destination: 2 },
  { id: "gate-3", x: 1750, y: 850, destination: 3 },
  { id: "gate-4", x: 250, y: 850, destination: 0, rare: true },
];

const achievementDefinitions = [
  ["welcome", "Welcome!", "Progression", "Join the server for the first time."],
  ["first_steps", "First Steps", "Progression", "Move a total of 1,000 pixels.", 1000],
  ["getting_started", "Getting Started", "Progression", "Collect 100 coins in total.", 100],
  ["pocket_change", "Pocket Change", "Progression", "Have 500 coins at once.", 500],
  ["getting_rich", "Getting Rich", "Progression", "Have 5,000 coins at once.", 5000],
  ["big_money", "Big Money", "Progression", "Have 25,000 coins at once.", 25000],
  ["millionaire", "Millionaire", "Progression", "Have 1,000,000 coins at once.", 1000000],
  ["shopaholic", "Shopaholic", "Progression", "Buy 10 shop items.", 10],
  ["upgraded", "Upgraded", "Progression", "Buy your first shop upgrade."],
  ["fully_upgraded", "Fully Upgraded", "Progression", "Reach the cap for damage, speed, or max HP."],
  ["first_blood", "First Blood", "PvP", "Get your first PvP kill.", 1],
  ["fighter", "Fighter", "PvP", "Get 10 PvP kills.", 10],
  ["warrior", "Warrior", "PvP", "Get 50 PvP kills.", 50],
  ["champion", "Champion", "PvP", "Get 100 PvP kills.", 100],
  ["untouchable", "Untouchable", "PvP", "Get a PvP kill without taking damage since your previous kill."],
  ["close_call", "Close Call", "PvP", "Get a PvP kill with exactly 1 HP remaining."],
  ["revenge", "Revenge!", "PvP", "Eliminate the player who last eliminated you."],
  ["double_kill", "Double Kill", "PvP", "Get two PvP kills within 10 seconds."],
  ["pvp_master", "PvP Master", "PvP", "Get 500 PvP kills.", 500],
  ["last_one_standing", "Last One Standing", "PvP", "Win an arena battle that started with at least four players."],
  ["troll_initiate", "Troll Initiate", "Troll Commands", "Unlock Troll Commands."],
  ["freeze_frame", "Freeze Frame", "Troll Commands", "Use /freeze."],
  ["blast_off", "Blast Off!", "Troll Commands", "Use /launch."],
  ["gotta_go_fast", "Gotta Go Fast", "Troll Commands", "Use /speed."],
  ["absolute_unit", "Absolute Unit", "Troll Commands", "Use /giant."],
  ["where_did_i_go", "Where Did I Go?", "Troll Commands", "Use /tiny."],
  ["spin_me", "Spin Me Right Round", "Troll Commands", "Use /spin."],
  ["not_banned", "Not Banned", "Troll Commands", "Use /fakeban."],
  ["get_out", "Get Out!", "Troll Commands", "Use /fakekick."],
  ["weather_control", "Weather Control", "Troll Commands", "Use /rain."],
  ["wrong_place", "Wrong Place, Wrong Time", "Troll Commands", "Use /swap."],
  ["where_am_i", "Where Am I?!", "Troll Commands", "Use /randomtp."],
  ["what_is_gravity", "What Is Gravity?", "Troll Commands", "Use /gravity."],
  ["brain_exe", "Brain.exe Stopped", "Troll Commands", "Use /confuse."],
  ["boo", "BOO!", "Troll Commands", "Use /jumpscare."],
  ["trust_rich", "Trust Me, You're Rich", "Troll Commands", "Use /fakecoins."],
  ["certified_menace", "Certified Menace", "Troll Commands", "Use five different Troll Commands.", 5],
  ["professional_troll", "Professional Troll", "Troll Commands", "Use every Troll Command.", 15],
  ["chaos_unleashed", "Chaos Unleashed", "Troll Commands", "Troll 10 different players.", 10],
  ["nobody_is_safe", "Nobody Is Safe", "Troll Commands", "Use 50 Troll Commands.", 50],
  ["are_you_sure", "Are You Sure?", "Secret", "Survive being launched."],
  ["tiny_survivor", "Tiny Survivor", "Secret", "Survive while tiny."],
  ["gravity_survivor", "Gravity? Never Heard Of It", "Secret", "Survive extreme gravity."],
  ["floor_is_gone", "The Floor Is Gone", "Secret", "Be randomly teleported 20 times.", 20],
  ["identity_crisis", "Identity Crisis", "Secret", "Be swapped with another player."],
  ["one_job", "You Had One Job", "Secret", "Be eliminated while confused."],
  ["trust_issues", "Trust Issues", "Secret", "Be fake-banned five times.", 5],
  ["why_raining", "Why Is It Raining?!", "Secret", "Stay through a full rain prank."],
  ["absolute_chaos", "Absolute Chaos", "Secret", "Experience five different Troll Commands in one session.", 5],
  ["bought_this", "You Should Not Have Bought This", "Secret", "Unlock Troll Commands."],
];
const achievementById = new Map(achievementDefinitions.map((entry) => [entry[0], entry]));
const trollAchievementByCommand = {
  freeze: "freeze_frame",
  launch: "blast_off",
  speed: "gotta_go_fast",
  giant: "absolute_unit",
  tiny: "where_did_i_go",
  spin: "spin_me",
  fakeban: "not_banned",
  fakekick: "get_out",
  rain: "weather_control",
  swap: "wrong_place",
  randomtp: "where_am_i",
  gravity: "what_is_gravity",
  confuse: "brain_exe",
  jumpscare: "boo",
  fakecoins: "trust_rich",
};

setInterval(() => {
  const now = Date.now();
  for (const player of Object.values(players)) {
    if (player.trollType && player.trollTypeUntil <= now) {
      if (player.trollType === "tiny" && player.hp > 0) {
        awardAchievement(player, "tiny_survivor");
      }
      if (player.trollType === "gravity" && player.hp > 0 && player.gravityAmount >= 3) {
        awardAchievement(player, "gravity_survivor");
      }
      player.trollType = null;
    }
    if (player.connected && player.rainUntil > 0 && player.rainUntil <= now && !player.rainAwarded) {
      player.rainAwarded = true;
      awardAchievement(player, "why_raining");
    }
    if (player.trollFallVelocity && now >= player.frozenUntil) {
      player.y = Math.max(15, Math.min(1085, player.y + player.trollFallVelocity));
      player.trollFallVelocity += player.trollGravityUntil > now
        ? player.trollGravityAmount
        : 1;
      pendingPlayerMoves.set(player.id, { id: player.id, x: player.x, y: player.y });
      if (player.y >= 1085 || player.trollFallVelocity > 30) {
        player.trollFallVelocity = 0;
        if (player.hp > 0 && player.lastLaunchedAt > 0) {
          awardAchievement(player, "are_you_sure");
          player.lastLaunchedAt = 0;
        }
        if (player.trollType === "gravity" && player.hp > 0 && player.gravityAmount >= 3) {
          awardAchievement(player, "gravity_survivor");
          player.trollType = null;
        }
      }
    }
  }

  if (pendingPlayerMoves.size === 0) {
    return;
  }

  const updates = Array.from(pendingPlayerMoves.values());
  pendingPlayerMoves.clear();
  io.volatile.emit("playerMoved", updates);
}, 50);

setInterval(() => {
  for (const player of Object.values(players)) {
    if (!player.connected || player.shieldRemainingMs <= 0) {
      continue;
    }

    player.shieldRemainingMs = Math.max(0, player.shieldRemainingMs - 1000);
    io.to(player.socketId).emit("shieldTime", player.shieldRemainingMs);

    if (player.shieldRemainingMs === 0) {
      savePlayerAccount(player);
      io.to(player.socketId).emit("chat", {
        name: "SERVER",
        message: "Your shield has expired.",
      });
      io.emit("players", players);
    }
  }
}, 1000);

function createCoin() {
  const id = Math.random().toString(36).slice(2, 10);

  coins[id] = {
    id,
    x: Math.floor(Math.random() * 1800) + 50,
    y: Math.floor(Math.random() * 900) + 50,
    value: 1,
  };
}

function randomPosition() {
  return {
    x: Math.floor(Math.random() * (worldWidth - 100)) + 50,
    y: Math.floor(Math.random() * (worldHeight - 100)) + 50,
  };
}

function createPowerUp() {
  const types = ["speed", "damage", "magnet", "shield", "heal", "invisibility"];
  const position = randomPosition();
  const id = crypto.randomBytes(6).toString("hex");
  powerUps[id] = { id, ...position, type: types[Math.floor(Math.random() * types.length)] };
}

function createRareCoin() {
  const position = randomPosition();
  const id = crypto.randomBytes(6).toString("hex");
  rareCoins[id] = { id, ...position, value: 50 };
  io.emit("chat", {
    name: "SERVER",
    message: "💎 A Rare Coin has appeared! Find it on the map for 50 coins!",
  });
}

function createEnemy() {
  const position = randomPosition();
  const strong = Math.random() < 0.25;
  const id = crypto.randomBytes(6).toString("hex");
  enemies[id] = {
    id,
    ...position,
    name: strong ? "Brute" : "Rogue",
    hp: strong ? 30 : 12,
    maxHp: strong ? 30 : 12,
    damage: strong ? 3 : 1,
    reward: strong ? 30 : 10,
    lastAttackAt: 0,
  };
}

function getClassStats(player) {
  const stats = {
    damage: player.damage,
    speed: player.speed,
    maxHp: player.maxHp,
    coinMultiplier: 1,
  };
  switch (player.gameClass) {
    case "Fighter":
      stats.damage += 2;
      stats.speed *= 0.85;
      break;
    case "Runner":
      stats.speed += 2;
      stats.maxHp = Math.max(1, stats.maxHp - 3);
      break;
    case "Tank":
      stats.maxHp += 10;
      stats.speed *= 0.8;
      break;
    case "Collector":
      stats.damage = Math.max(1, stats.damage - 1);
      stats.coinMultiplier = 2;
      break;
  }
  return stats;
}

function addCoins(player, amount) {
  const coinsEarned = Math.max(0, Math.floor(amount));
  player.score += coinsEarned;
  checkCoinBalanceAchievements(player);
  savePlayerAccount(player);
  return coinsEarned;
}

function broadcastWorldState() {
  io.emit("worldEvents", {
    capturePoint: {
      x: capturePoint.x,
      y: capturePoint.y,
      ownerId: capturePoint.ownerId,
      progressMs: capturePoint.progressMs,
    },
    zone: dynamicZone,
    weather,
    powerUps: Object.values(powerUps),
    rareCoins: Object.values(rareCoins),
    enemies: Object.values(enemies).map(({ lastAttackAt, ...enemy }) => enemy),
    gates: teleportGates,
  });
}

for (let i = 0; i < 20; i++) {
  createCoin();
}

capturePoint.x = randomPosition().x;
capturePoint.y = randomPosition().y;

setInterval(() => {
  const now = Date.now();
  let playersChanged = false;

  if (now >= nextPowerUpAt && Object.keys(powerUps).length < 8) {
    createPowerUp();
    nextPowerUpAt = now + 12000;
  }
  if (now >= nextRareCoinAt && Object.keys(rareCoins).length < 2) {
    createRareCoin();
    nextRareCoinAt = now + 30000 + Math.floor(Math.random() * 30000);
  }
  if (now >= nextEnemyAt && Object.keys(enemies).length < 6) {
    createEnemy();
    nextEnemyAt = now + 18000;
  }
  if (!dynamicZone && now >= nextZoneAt) {
    const types = ["damage", "healing", "doubleCoins", "teleport", "danger"];
    dynamicZone = {
      id: crypto.randomBytes(5).toString("hex"),
      ...randomPosition(),
      type: types[Math.floor(Math.random() * types.length)],
      radius: 125,
      until: now + 30000,
    };
    nextZoneAt = now + 60000;
    const labels = {
      damage: "Damage Zone",
      healing: "Healing Zone",
      doubleCoins: "Double Coin Zone",
      teleport: "Teleport Zone",
      danger: "Danger Zone",
    };
    io.emit("chat", { name: "SERVER", message: `🗺️ ${labels[dynamicZone.type]} has appeared!` });
  } else if (dynamicZone && dynamicZone.until <= now) {
    dynamicZone = null;
    nextZoneAt = now + 30000;
  }
  if (now >= nextWeatherAt) {
    const types = ["coinRain", "speedStorm", "darkness", "chaosStorm"];
    weather = { type: types[Math.floor(Math.random() * types.length)], until: now + 25000 };
    nextWeatherAt = now + 90000;
    const labels = {
      coinRain: "Coin Rain",
      speedStorm: "Speed Storm",
      darkness: "Darkness",
      chaosStorm: "Chaos Storm",
    };
    io.emit("chat", { name: "SERVER", message: `🌧️ ${labels[weather.type]} is active for 25 seconds!` });
  } else if (weather.type && weather.until <= now) {
    weather = { type: null, until: 0 };
  }

  if (weather.type === "coinRain" && Object.keys(coins).length < 60) {
    createCoin();
    createCoin();
  }
  if (weather.type === "chaosStorm" && now >= nextChaosEffectAt) {
    const onlinePlayers = Object.values(players).filter((player) => player.connected);
    if (onlinePlayers.length) {
      const player = onlinePlayers[Math.floor(Math.random() * onlinePlayers.length)];
      const effect = Math.floor(Math.random() * 4);
      if (effect === 0) {
        Object.assign(player, randomPosition());
        pendingPlayerMoves.set(player.id, { id: player.id, x: player.x, y: player.y });
        io.to(player.socketId).emit("chat", { name: "SERVER", message: "🌀 Chaos Storm teleported you!" });
      } else if (effect === 1) {
        player.hp = Math.min(getClassStats(player).maxHp, player.hp + 3);
        io.to(player.socketId).emit("chat", { name: "SERVER", message: "💚 Chaos Storm healed you!" });
      } else if (effect === 2) {
        player.hp = Math.max(1, player.hp - 2);
        io.to(player.socketId).emit("chat", { name: "SERVER", message: "⚡ Chaos Storm zapped you!" });
      } else {
        addCoins(player, 5);
        io.to(player.socketId).emit("chat", { name: "SERVER", message: "🪙 Chaos Storm gave you 5 coins!" });
      }
      playersChanged = true;
    }
    nextChaosEffectAt = now + 2500;
  }

  for (const player of Object.values(players)) {
    if (!player.connected) {
      continue;
    }
    const bounty = Math.max(player.bounty || 0, Math.floor(player.score / 1000));
    const wantedLevel = Math.max(player.wantedLevel || 0, Math.min(5, Math.floor(bounty / 50)));
    if (bounty !== player.bounty || wantedLevel !== player.wantedLevel) {
      player.bounty = bounty;
      player.wantedLevel = wantedLevel;
      playersChanged = true;
    }

    if (player.powerUpUntil) {
      for (const [type, until] of Object.entries(player.powerUpUntil)) {
        if (until <= now) {
          delete player.powerUpUntil[type];
          playersChanged = true;
        }
      }
    }

    if (player.regenerationUntil > now && player.hp < getClassStats(player).maxHp) {
      player.hp = Math.min(getClassStats(player).maxHp, player.hp + 1);
      playersChanged = true;
    }

    if (dynamicZone && Math.hypot(player.x - dynamicZone.x, player.y - dynamicZone.y) <= dynamicZone.radius) {
      const lastTick = lastPlayerZoneTick.get(player.id) || 0;
      if (now - lastTick >= 1000) {
        lastPlayerZoneTick.set(player.id, now);
        if (dynamicZone.type === "healing") {
          player.hp = Math.min(getClassStats(player).maxHp, player.hp + 2);
          playersChanged = true;
        } else if (dynamicZone.type === "damage" || dynamicZone.type === "danger") {
          if (player.shieldRemainingMs <= 0 && (player.powerUpUntil?.shield || 0) <= now) {
            player.hp = Math.max(1, player.hp - (dynamicZone.type === "danger" ? 3 : 1));
            playersChanged = true;
          }
        } else if (dynamicZone.type === "teleport" && (player.zoneTeleportAt || 0) <= now) {
          Object.assign(player, randomPosition());
          player.zoneTeleportAt = now + 8000;
          pendingPlayerMoves.set(player.id, { id: player.id, x: player.x, y: player.y });
          playersChanged = true;
        }
      }
    }

    if (capturePoint.ownerId === player.id) {
      const held = Math.hypot(player.x - capturePoint.x, player.y - capturePoint.y) <= 110;
      const contested = Object.values(players).some((otherPlayer) =>
        otherPlayer.id !== player.id && otherPlayer.connected &&
        Math.hypot(otherPlayer.x - capturePoint.x, otherPlayer.y - capturePoint.y) <= 110
      );
      if (held && !contested) {
        capturePoint.progressMs += 1000;
        capturePoint.rewardElapsedMs += 1000;
        if (capturePoint.rewardElapsedMs >= 5000) {
          capturePoint.rewardElapsedMs = 0;
          addCoins(player, 5);
          playersChanged = true;
        }
      } else if (!held) {
        capturePoint.ownerId = null;
        capturePoint.progressMs = 0;
        capturePoint.rewardElapsedMs = 0;
      }
    }
  }

  for (const enemy of Object.values(enemies)) {
    if (now - enemy.lastAttackAt < 1500) {
      continue;
    }
    const target = Object.values(players).find((player) =>
      player.connected && Math.hypot(player.x - enemy.x, player.y - enemy.y) < 65
    );
    if (!target) {
      continue;
    }
    enemy.lastAttackAt = now;
    if (target.shieldRemainingMs <= 0 && (target.powerUpUntil?.shield || 0) <= now) {
      target.hp -= enemy.damage;
      target.damageTakenSinceKill = true;
      if (target.hp <= 0) {
        const dropped = Math.min(50, Math.floor(target.score * 0.1));
        if (dropped > 0) {
          target.score -= dropped;
          const coinId = crypto.randomBytes(6).toString("hex");
          coins[coinId] = { id: coinId, x: target.x, y: target.y, value: dropped };
        }
        target.hp = getClassStats(target).maxHp;
        Object.assign(target, randomPosition());
        io.emit("chat", { name: "SERVER", message: `🧟 ${target.name} was knocked out by a ${enemy.name}!` });
      }
      playersChanged = true;
    }
  }

  for (const [id, coin] of Object.entries(coins)) {
    if (coin.createdAt && now - coin.createdAt > 120000) {
      delete coins[id];
    }
  }

  if (playersChanged) {
    io.emit("players", players);
    io.emit("coins", coins);
  }
  broadcastWorldState();
}, 1000);

function cleanName(name) {
  const value = String(name ?? "").trim();
  const trimmed = value.slice(0, 16);

  if (trimmed.length < 2) {
    return null;
  }

  return trimmed;
}

function findOnlinePlayer(name) {
  const normalizedName = cleanName(name)?.toLowerCase();
  if (!normalizedName) {
    return null;
  }

  return Object.values(players).find(
    (player) => player.connected && player.name.toLowerCase() === normalizedName
  ) || null;
}

function sendTrollEffect(player, effect, duration, value) {
  io.to(player.socketId).emit("trollEffect", { effect, duration, value });
}

function publishArenaStatus() {
  io.emit("arenaStatus", {
    queued: arenaQueue.size,
    active: activeArena ? activeArena.alive.size : 0,
  });
}

function finishArena(winnerId = null) {
  if (!activeArena) {
    return;
  }

  const arena = activeArena;
  activeArena = null;
  for (const id of arena.contestants) {
    const player = players[id];
    if (player) {
      player.arenaSessionId = null;
    }
  }

  const winner = winnerId ? players[winnerId] : null;
  if (winner) {
    if (arena.startingCount >= ARENA_MIN_PLAYERS) {
      awardAchievement(winner, "last_one_standing");
    }
    io.emit("chat", {
      name: "ARENA",
      message: `${winner.name} won the arena!`,
    });
  } else {
    io.emit("chat", { name: "ARENA", message: "The arena ended without a winner." });
  }
  publishArenaStatus();
  if (arenaQueue.size >= 2 && !arenaStartTimer) {
    arenaStartTimer = setTimeout(beginArena, ARENA_READY_DELAY_MS);
  }
}

function beginArena() {
  arenaStartTimer = null;
  if (activeArena) {
    publishArenaStatus();
    return;
  }
  const entrants = Array.from(arenaQueue)
    .map((id) => players[id])
    .filter((player) => player?.connected)
    .slice(0, ARENA_MAX_PLAYERS);
  for (const entrant of entrants) {
    arenaQueue.delete(entrant.id);
  }

  if (entrants.length < 2) {
    publishArenaStatus();
    return;
  }

  const contestantIds = new Set(entrants.map((player) => player.id));
  activeArena = {
    id: crypto.randomUUID(),
    contestants: contestantIds,
    alive: new Set(contestantIds),
    startingCount: entrants.length,
  };

  entrants.forEach((player, index) => {
    const angle = (Math.PI * 2 * index) / entrants.length;
    player.arenaSessionId = activeArena.id;
    player.pvp = true;
    player.hp = player.maxHp;
    player.damageTakenSinceKill = false;
    player.x = 1000 + Math.cos(angle) * 220;
    player.y = 550 + Math.sin(angle) * 160;
    pendingPlayerMoves.set(player.id, { id: player.id, x: player.x, y: player.y });
  });

  io.emit("chat", {
    name: "ARENA",
    message: `Arena battle started with ${entrants.length} players! PvP is on.`,
  });
  io.emit("players", players);
  publishArenaStatus();
}

function queueForArena(player) {
  if (activeArena?.alive.has(player.id)) {
    io.to(player.socketId).emit("chat", { name: "ARENA", message: "You are already in the active arena." });
    return;
  }
  if (arenaQueue.has(player.id)) {
    arenaQueue.delete(player.id);
    if (arenaQueue.size < 2 && arenaStartTimer) {
      clearTimeout(arenaStartTimer);
      arenaStartTimer = null;
    }
    io.to(player.socketId).emit("chat", { name: "ARENA", message: "You left the arena queue." });
  } else {
    arenaQueue.add(player.id);
    io.to(player.socketId).emit("chat", { name: "ARENA", message: "Joined the arena queue." });
  }

  if (arenaQueue.size >= 2 && !arenaStartTimer && !activeArena) {
    arenaStartTimer = setTimeout(beginArena, ARENA_READY_DELAY_MS);
  }
  publishArenaStatus();
}

function findAccountName(name) {
  const normalizedName = cleanName(name)?.toLowerCase();
  if (!normalizedName) {
    return null;
  }

  return Object.keys(accounts).find((accountName) => accountName.toLowerCase() === normalizedName) || null;
}

function getAchievementData(player) {
  const account = accounts[player.name];
  if (!account) {
    return { unlocked: [], progress: {}, stats: {} };
  }

  account.achievements ||= { unlocked: [], progress: {}, stats: {} };
  account.achievements.unlocked ||= [];
  account.achievements.progress ||= {};
  account.achievements.stats ||= {};
  return account.achievements;
}

function sendAchievementSnapshot(player) {
  const data = getAchievementData(player);
  io.to(player.socketId).emit("achievements", achievementDefinitions.map(([id, name, category, description, goal]) => ({
    id,
    name,
    category,
    description,
    goal: goal || null,
    progress: data.progress[id] || 0,
    unlocked: data.unlocked.includes(id),
  })));
}

function awardAchievement(player, id) {
  const definition = achievementById.get(id);
  if (!definition) {
    return;
  }

  const data = getAchievementData(player);
  if (data.unlocked.includes(id)) {
    return;
  }

  data.unlocked.push(id);
  data.progress[id] = definition[4] || 1;
  savePlayerAccount(player);
  io.to(player.socketId).emit("achievementUnlocked", {
    id,
    name: definition[1],
    description: definition[3],
  });
}

function setAchievementProgress(player, id, progress) {
  const definition = achievementById.get(id);
  const data = getAchievementData(player);
  if (!definition || data.unlocked.includes(id)) {
    return;
  }

  const nextProgress = Math.max(0, Math.floor(progress));
  const previousProgress = data.progress[id] || 0;
  if (nextProgress === previousProgress) {
    return;
  }
  data.progress[id] = nextProgress;
  scheduleAccountsSave();
  const reportProgress = id !== "first_steps" ||
    nextProgress >= definition[4] ||
    Math.floor(nextProgress / 50) > Math.floor(previousProgress / 50);
  if (reportProgress && nextProgress !== previousProgress) {
    io.to(player.socketId).emit("achievementProgress", { id, progress: nextProgress });
  }
  if (definition[4] && nextProgress >= definition[4]) {
    awardAchievement(player, id);
  }
}

function addAchievementProgress(player, id, amount = 1) {
  const data = getAchievementData(player);
  setAchievementProgress(player, id, (data.progress[id] || 0) + amount);
}

function checkCoinBalanceAchievements(player) {
  const data = getAchievementData(player);
  data.stats.maxCoins = Math.max(data.stats.maxCoins || 0, player.score);
  for (const [id, threshold] of [
    ["pocket_change", 500],
    ["getting_rich", 5000],
    ["big_money", 25000],
    ["millionaire", 1000000],
  ]) {
    setAchievementProgress(player, id, Math.min(data.stats.maxCoins, threshold));
  }
}

function recordTrollCommand(user, target, command, countUse = true) {
  const data = getAchievementData(user);
  const usedCommands = data.stats.trollCommands || [];
  if (countUse && !usedCommands.includes(command)) {
    usedCommands.push(command);
    data.stats.trollCommands = usedCommands;
  }
  const targets = data.stats.trollTargets || [];
  if (!targets.includes(target.name)) {
    targets.push(target.name);
    data.stats.trollTargets = targets;
  }
  if (countUse) {
    addAchievementProgress(user, "nobody_is_safe");
  }
  setAchievementProgress(user, "certified_menace", usedCommands.length);
  setAchievementProgress(user, "professional_troll", usedCommands.length);
  setAchievementProgress(user, "chaos_unleashed", targets.length);
  if (countUse) {
    user.sessionTrollCommands ||= new Set();
    user.sessionTrollCommands.add(command);
    if (user.sessionTrollCommands.size >= 5) {
      awardAchievement(user, "absolute_chaos");
    }
  }
  const achievementId = countUse ? trollAchievementByCommand[command] : null;
  if (achievementId) {
    awardAchievement(user, achievementId);
  }

  if (command) {
    target.sessionTrollEffects ||= new Set();
    target.sessionTrollEffects.add(command);
    if (target.sessionTrollEffects.size >= 5) {
      awardAchievement(target, "absolute_chaos");
    }
  }
}

function parseDuration(value) {
  const match = /^([1-9]\d*)(s|m|h|d)$/i.exec(value || "");
  if (!match) {
    return null;
  }

  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const duration = Number(match[1]) * units[match[2].toLowerCase()];
  return Number.isSafeInteger(duration) && duration <= Number.MAX_SAFE_INTEGER - Date.now()
    ? duration
    : null;
}

function getModerationStatus(account) {
  const now = Date.now();
  let changed = false;

  for (const action of ["muted", "banned"]) {
    const untilKey = `${action}Until`;
    if (account[action] && account[untilKey] > 0 && account[untilKey] <= now) {
      account[action] = false;
      account[untilKey] = null;
      account[`${action}Reason`] = "";
      changed = true;
    }
  }

  if (changed) {
    saveAccounts(accounts);
  }

  return {
    muted: Boolean(account.muted),
    banned: Boolean(account.banned),
  };
}

function clearModeration(account, action) {
  account[action] = false;
  account[`${action}Until`] = null;
  account[`${action}Reason`] = "";
}

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  if (typeof username !== "string" || typeof password !== "string") {
    return res.json({
      success: false,
      message: "Invalid data.",
    });
  }

  const name = cleanName(username);

  if (!name) {
    return res.json({
      success: false,
      message: "Username must be 2–16 characters.",
    });
  }

  if (password.length < 4) {
    return res.json({
      success: false,
      message: "Password must be at least 4 characters.",
    });
  }

  if (accounts[name]) {
    return res.json({
      success: false,
      message: "Account already exists.",
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  accounts[name] = {
  username: name,
  passwordHash,
  admin: false,
  score: 0,
  damage: 1,
  maxHp: 10,
  speed: 5,
  crossbow: false,
  arrows: 0,
  shieldRemainingMs: 0,
  trollcmds: false,
  achievements: { unlocked: [], progress: {}, stats: {} },
};

  saveAccounts(accounts);

  return res.json({
    success: true,
    message: "Account created!",
  });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const name = cleanName(username);
  const account = name ? accounts[name] : null;

  if (!account) {
    return res.json({
      success: false,
      message: "Incorrect username or password.",
    });
  }

  const correct = await bcrypt.compare(String(password ?? ""), account.passwordHash);

  if (!correct) {
    return res.json({
      success: false,
      message: "Incorrect username or password.",
    });
  }

  if (getModerationStatus(account).banned) {
    const reason = account.banReason ? ` Reason: ${account.banReason}` : "";
    return res.json({
      success: false,
      message: `This account is banned.${reason}`,
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions[token] = name;

  return res.json({
    success: true,
    token,
    username: name,
  });
});

io.on("connection", (socket) => {
  const playerId = socket.handshake.auth?.playerId;
  const requestedName = cleanName(socket.handshake.auth?.playerName);
  const token = socket.handshake.auth?.token;
  const authenticatedName = sessions[token];

  if (!playerId || !requestedName || authenticatedName !== requestedName) {
    socket.disconnect(true);
    return;
  }

  const accountName = findAccountName(requestedName);
  if (!accountName || accountName !== authenticatedName) {
    socket.disconnect(true);
    return;
  }

  const account = accountName ? accounts[accountName] : null;
  if (account && getModerationStatus(account).banned) {
    socket.disconnect(true);
    return;
  }

  let player = players[playerId];

  if (!player) {
    const playerAccount = account || {};
    const maxHp = Math.max(1, Number(playerAccount.maxHp) || 10);
    player = {
      id: playerId,
      socketId: socket.id,
      name: requestedName || "Player_" + Math.floor(Math.random() * 9000 + 1000),
      x: 400,
      y: 300,
      score: Math.max(0, Number(playerAccount.score) || 0),
      damage: Math.max(1, Number(playerAccount.damage) || 1),
      maxHp,
      hp: maxHp,
      speed: Math.max(1, Number(playerAccount.speed) || 5),
      gameClass: playerClasses.includes(playerAccount.gameClass) ? playerAccount.gameClass : "Fighter",
      pvp: false,
      crossbow: Boolean(playerAccount.crossbow),
      arrows: Math.max(0, Number(playerAccount.arrows) || 0),
      shieldRemainingMs: Math.max(0, Number(playerAccount.shieldRemainingMs) || 0),
      trollcmds: Boolean(playerAccount.trollcmds),
      powerUpUntil: {},
      kills: 0,
      bounty: 0,
      wantedLevel: 0,
      zoneTeleportAt: 0,
      gateCooldownUntil: 0,
      frozenUntil: 0,
      speedBoostUntil: 0,
      speedBoost: 0,
      confusedUntil: 0,
      gravityUntil: 0,
      gravityAmount: 1,
      trollFallVelocity: 0,
      distanceMoved: 0,
      lastKilledBy: null,
      lastKillAt: 0,
      damageTakenSinceKill: false,
      arenaSessionId: null,
      sessionTrollCommands: new Set(),
      sessionTrollEffects: new Set(),
      lastTrollVictimId: null,
      randomTeleports: 0,
      fakeBansReceived: 0,
      rainUntil: 0,
      rainAwarded: false,
      trollType: null,
      trollTypeUntil: 0,
      shieldLastUpdate: 0,
      connected: true,
    };

    players[playerId] = player;
    player.hp = getClassStats(player).maxHp;
    player.distanceMoved = getAchievementData(player).stats.distanceMoved || 0;
    console.log(`[JOIN] ${player.name}`);
  } else {
    player.socketId = socket.id;
    player.connected = true;
    if (requestedName) {
      player.name = requestedName;
    }
    player.gameClass ||= "Fighter";
    player.powerUpUntil ||= {};
    player.kills ||= 0;
    player.bounty ||= 0;
    player.wantedLevel ||= 0;
    console.log(`[REJOIN] ${player.name}`);
  }

  socket.emit("players", players);
  socket.emit("coins", coins);
  broadcastWorldState();
  socket.broadcast.emit("players", players);
  const achievementData = getAchievementData(player);
  if (!achievementData.unlocked.includes("welcome")) {
    awardAchievement(player, "welcome");
  }
  sendAchievementSnapshot(player);
  checkCoinBalanceAchievements(player);
  publishArenaStatus();
  if (
    player.damage >= 10 ||
    player.maxHp >= 50 ||
    player.speed >= 10
  ) {
    awardAchievement(player, "fully_upgraded");
  }

  socket.on("arenaQueue", () => {
    const currentPlayer = players[playerId];
    if (currentPlayer) {
      queueForArena(currentPlayer);
    }
  });

  socket.on("selectClass", (className, acknowledge) => {
    const currentPlayer = players[playerId];
    const respond = (success, message) => {
      if (typeof acknowledge === "function") acknowledge({ success, message });
    };
    if (!currentPlayer || !playerClasses.includes(className)) {
      respond(false, "Choose a valid class.");
      return;
    }
    const previousMaxHp = getClassStats(currentPlayer).maxHp;
    const hpRatio = previousMaxHp > 0 ? currentPlayer.hp / previousMaxHp : 1;
    currentPlayer.gameClass = className;
    const nextMaxHp = getClassStats(currentPlayer).maxHp;
    currentPlayer.hp = Math.max(1, Math.min(nextMaxHp, Math.round(hpRatio * nextMaxHp)));
    savePlayerAccount(currentPlayer);
    io.emit("players", players);
    respond(true, `${className} class selected.`);
  });

  socket.on("move", (movement) => {
    const currentPlayer = players[playerId];

    if (!currentPlayer) {
      return;
    }

    if (currentPlayer.frozenUntil > Date.now()) {
      return;
    }

    let x = Number(movement?.x) || 0;
    let y = Number(movement?.y) || 0;
    if (currentPlayer.confusedUntil > Date.now()) {
      [x, y] = [y, -x];
    }
    const distance = Math.hypot(x, y);
    if (distance > 1) {
      x /= distance;
      y /= distance;
    }
    const effectiveStats = getClassStats(currentPlayer);
    const hasSpeedPowerUp = (currentPlayer.powerUpUntil?.speed || 0) > Date.now();
    const movementSpeed = currentPlayer.speedBoostUntil > Date.now()
      ? currentPlayer.speedBoost
      : effectiveStats.speed * (hasSpeedPowerUp ? 1.7 : 1) * (weather.type === "speedStorm" ? 1.5 : 1);
    x *= movementSpeed;
    y *= movementSpeed;

    const previousX = currentPlayer.x;
    const previousY = currentPlayer.y;
    currentPlayer.x += x;
    currentPlayer.y += y;

    currentPlayer.x = Math.max(15, Math.min(1985, currentPlayer.x));
    currentPlayer.y = Math.max(15, Math.min(1085, currentPlayer.y));
    if (currentPlayer.arenaSessionId === activeArena?.id) {
      currentPlayer.x = Math.max(750, Math.min(1250, currentPlayer.x));
      currentPlayer.y = Math.max(350, Math.min(750, currentPlayer.y));
    }
    const moved = Math.hypot(currentPlayer.x - previousX, currentPlayer.y - previousY);
    currentPlayer.distanceMoved += moved;
    const movementAchievements = getAchievementData(currentPlayer);
    movementAchievements.stats.distanceMoved = currentPlayer.distanceMoved;
    setAchievementProgress(currentPlayer, "first_steps", movementAchievements.stats.distanceMoved);

    let collectedCoin = false;
    const coinMagnetActive = (currentPlayer.powerUpUntil?.magnet || 0) > Date.now();
    const collectorMultiplier = effectiveStats.coinMultiplier;
    const doubleCoinsZone = dynamicZone?.type === "doubleCoins" &&
      Math.hypot(currentPlayer.x - dynamicZone.x, currentPlayer.y - dynamicZone.y) <= dynamicZone.radius;
    const coinWeatherMultiplier = weather.type === "chaosStorm" ? 2 : 1;
    for (const coinId in coins) {
      const coin = coins[coinId];
      const dx = currentPlayer.x - coin.x;
      const dy = currentPlayer.y - coin.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < (coinMagnetActive ? 160 : 30)) {
        const reward = Math.max(1, (coin.value || 1) * collectorMultiplier *
          (doubleCoinsZone ? 2 : 1) * coinWeatherMultiplier);
        addCoins(currentPlayer, reward);
        const achievementData = getAchievementData(currentPlayer);
        achievementData.stats.coinsCollected = (achievementData.stats.coinsCollected || 0) + reward;
        setAchievementProgress(currentPlayer, "getting_started", achievementData.stats.coinsCollected);
        console.log(`[COIN] ${currentPlayer.name} +${reward}`);
        delete coins[coinId];
        if (!coin.value || coin.value === 1) createCoin();
        collectedCoin = true;
      }
    }

    for (const [rareCoinId, rareCoin] of Object.entries(rareCoins)) {
      if (Math.hypot(currentPlayer.x - rareCoin.x, currentPlayer.y - rareCoin.y) < 40) {
        const reward = rareCoin.value * collectorMultiplier * (doubleCoinsZone ? 2 : 1);
        addCoins(currentPlayer, reward);
        delete rareCoins[rareCoinId];
        collectedCoin = true;
        socket.emit("chat", { name: "SERVER", message: `💎 You collected a Rare Coin worth ${reward} coins!` });
      }
    }

    for (const [powerUpId, powerUp] of Object.entries(powerUps)) {
      if (Math.hypot(currentPlayer.x - powerUp.x, currentPlayer.y - powerUp.y) >= 32) continue;
      delete powerUps[powerUpId];
      currentPlayer.powerUpUntil ||= {};
      const duration = 15000;
      switch (powerUp.type) {
        case "speed":
        case "damage":
        case "magnet":
        case "shield":
        case "invisibility":
          currentPlayer.powerUpUntil[powerUp.type] = Date.now() + duration;
          break;
        case "heal":
          currentPlayer.hp = Math.min(getClassStats(currentPlayer).maxHp, currentPlayer.hp + 8);
          break;
      }
      io.emit("chat", { name: "SERVER", message: `⚡ ${currentPlayer.name} picked up ${powerUp.type}!` });
      collectedCoin = true;
    }

    if (Math.hypot(currentPlayer.x - capturePoint.x, currentPlayer.y - capturePoint.y) <= 110) {
      const otherPlayerContesting = Object.values(players).some((playerEntry) =>
        playerEntry.id !== playerId && playerEntry.connected &&
        Math.hypot(playerEntry.x - capturePoint.x, playerEntry.y - capturePoint.y) <= 110
      );
      if (!otherPlayerContesting && capturePoint.ownerId !== playerId) {
        capturePoint.ownerId = playerId;
        capturePoint.progressMs = 0;
        capturePoint.rewardElapsedMs = 0;
        io.emit("chat", { name: "SERVER", message: `🏴 ${currentPlayer.name} is capturing the point!` });
      }
    }

    if (Date.now() >= currentPlayer.gateCooldownUntil) {
      const gate = teleportGates.find((entry) => Math.hypot(currentPlayer.x - entry.x, currentPlayer.y - entry.y) < 35);
      if (gate) {
        const destination = randomPosition();
        currentPlayer.x = destination.x;
        currentPlayer.y = destination.y;
        currentPlayer.gateCooldownUntil = Date.now() + 3000;
        pendingPlayerMoves.set(playerId, { id: playerId, x: currentPlayer.x, y: currentPlayer.y });
        if (gate.rare) {
          addCoins(currentPlayer, 25);
          socket.emit("chat", { name: "SERVER", message: "🌀 The rare gate gave you 25 bonus coins!" });
        } else {
          socket.emit("chat", { name: "SERVER", message: "🌀 The gate sent you to a random location!" });
        }
        collectedCoin = true;
      }
    }

    if (collectedCoin) {
      pendingPlayerMoves.delete(currentPlayer.id);
      io.emit("players", players);
      io.emit("coins", coins);
      broadcastWorldState();
    } else {
      pendingPlayerMoves.set(currentPlayer.id, {
        id: currentPlayer.id,
        x: currentPlayer.x,
        y: currentPlayer.y,
      });
    }
  });
socket.on("buyItem", (item, acknowledge) => {
  const respond = (success, message) => {
    socket.emit("chat", { name: "SERVER", message });
    if (typeof acknowledge === "function") {
      acknowledge({ success, message });
    }
  };

  const currentPlayer = players[playerId];

  if (!currentPlayer) {
    respond(false, "Your player is not connected; purchase cancelled.");
    return;
  }

  const account = accounts[currentPlayer.name];
  if (!account) {
    respond(false, "Account not found; purchase cancelled.");
    return;
  }

  const prices = {
    damage: 50,
    hp: 100,
    speed: 50,
    crossbow: 1500,
    shield: 15000,
    arrows: 15,
    trollcmds: 100000,
  };
  if (typeof item !== "string" || !Object.hasOwn(prices, item)) {
    respond(false, "Unknown shop item.");
    return;
  }

  const price = prices[item];

  if (item === "crossbow" && currentPlayer.crossbow) {
    respond(false, "You already own a crossbow.");
    return;
  }
  if (item === "trollcmds" && currentPlayer.trollcmds) {
    respond(false, "You already own Troll Commands.");
    return;
  }

  const upgradeCaps = { damage: 10, hp: 50, speed: 10 };
  if (
    (item === "damage" && currentPlayer.damage >= upgradeCaps.damage) ||
    (item === "hp" && currentPlayer.maxHp >= upgradeCaps.hp) ||
    (item === "speed" && currentPlayer.speed >= upgradeCaps.speed)
  ) {
    respond(false, `That upgrade is already maxed out (caps: damage ${upgradeCaps.damage}, max HP ${upgradeCaps.hp}, speed ${upgradeCaps.speed}).`);
    return;
  }

  if (currentPlayer.score < price) {
    respond(false, `You need ${price} 🪙 for this purchase.`);
    return;
  }

  currentPlayer.score -= price;
  const achievementData = getAchievementData(currentPlayer);
  achievementData.stats.shopPurchases = (achievementData.stats.shopPurchases || 0) + 1;
  setAchievementProgress(currentPlayer, "shopaholic", achievementData.stats.shopPurchases);
  if (["damage", "hp", "speed"].includes(item)) {
    awardAchievement(currentPlayer, "upgraded");
  }
  switch (item) {
    case "damage":
      currentPlayer.damage += 1;
      break;
    case "hp":
      currentPlayer.maxHp += 1;
      currentPlayer.hp = Math.min(currentPlayer.maxHp, currentPlayer.hp + 1);
      break;
    case "speed":
      currentPlayer.speed += 1;
      break;
    case "crossbow":
      currentPlayer.crossbow = true;
      break;
    case "shield":
      currentPlayer.shieldRemainingMs += 15 * 60 * 1000;
      break;
    case "arrows":
      currentPlayer.arrows += 5;
      break;
    case "trollcmds":
      currentPlayer.trollcmds = true;
      awardAchievement(currentPlayer, "troll_initiate");
      awardAchievement(currentPlayer, "bought_this");
      break;
  }
  if (
    currentPlayer.damage >= upgradeCaps.damage ||
    currentPlayer.maxHp >= upgradeCaps.hp ||
    currentPlayer.speed >= upgradeCaps.speed
  ) {
    awardAchievement(currentPlayer, "fully_upgraded");
  }
  checkCoinBalanceAchievements(currentPlayer);

  savePlayerAccount(currentPlayer);

  io.emit("players", players);
  respond(
    true,
    `Purchase successful: ${item === "hp" ? "+1 max HP" : item === "arrows" ? "+5 arrows" : item === "shield" ? "15 minutes of shield" : item === "crossbow" ? "crossbow unlocked" : item === "trollcmds" ? "Troll Commands unlocked" : `+1 ${item}`}!`
  );
});
socket.on("attack", () => {
  const attacker = players[playerId];

  if (!attacker || !attacker.connected) {
    return;
  }

  if (attacker.crossbow && attacker.arrows <= 0) {
    socket.emit("chat", { name: "SERVER", message: "You need arrows to use your crossbow." });
    return;
  }

  let target = null;
  let closestDistance = Infinity;
  let enemyTarget = null;
  let closestEnemyDistance = Infinity;

  for (const enemy of Object.values(enemies)) {
    const distance = Math.hypot(attacker.x - enemy.x, attacker.y - enemy.y);
    if (distance < 65 && distance < closestEnemyDistance) {
      closestEnemyDistance = distance;
      enemyTarget = enemy;
    }
  }

  if (attacker.pvp) {
    for (const id in players) {
      if (id === playerId) {
        continue;
      }

      const player = players[id];

      if (!player.connected || !player.pvp || (player.powerUpUntil?.invisibility || 0) > Date.now()) {
        continue;
      }
      if (
        (attacker.arenaSessionId && player.arenaSessionId !== attacker.arenaSessionId) ||
        (!attacker.arenaSessionId && player.arenaSessionId)
      ) {
        continue;
      }

      const dx = attacker.x - player.x;
      const dy = attacker.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const attackRange = attacker.crossbow ? 500 : 60;
      if (distance < attackRange && distance < closestDistance) {
        closestDistance = distance;
        target = player;
      }
    }
  }

  if (enemyTarget && closestEnemyDistance < closestDistance) {
    const damage = getClassStats(attacker).damage *
      ((attacker.powerUpUntil?.damage || 0) > Date.now() ? 2 : 1);
    enemyTarget.hp -= damage;
    if (attacker.crossbow) {
      attacker.arrows -= 1;
      savePlayerAccount(attacker);
    }
    if (enemyTarget.hp <= 0) {
      const enemyId = enemyTarget.id;
      addCoins(attacker, enemyTarget.reward);
      delete enemies[enemyId];
      if (Math.random() < 0.35) createPowerUp();
      socket.emit("chat", {
        name: "SERVER",
        message: `🧟 You defeated a ${enemyTarget.name} and earned ${enemyTarget.reward} coins!`,
      });
    }
    io.emit("players", players);
    broadcastWorldState();
    return;
  }

  if (!target) {
    socket.emit("chat", {
      name: "SERVER",
      message: attacker.pvp
        ? "No PvP-enabled player or enemy is within attack range."
        : "Enable PvP with /pvp to attack players. Enemies can be attacked nearby.",
    });
    return;
  }

  if (attacker.crossbow) {
    attacker.arrows -= 1;
    savePlayerAccount(attacker);
  }

  if (target.shieldRemainingMs > 0 || (target.powerUpUntil?.shield || 0) > Date.now()) {
    socket.emit("chat", {
      name: "SERVER",
      message: `${target.name} is protected by a shield.`,
    });
    io.to(target.socketId).emit("chat", {
      name: "SERVER",
      message: "🛡️ Your shield blocked an attack.",
    });
    io.emit("players", players);
    return;
  }

  const dealtDamage = getClassStats(attacker).damage *
    ((attacker.powerUpUntil?.damage || 0) > Date.now() ? 2 : 1);
  target.hp -= dealtDamage;
  target.damageTakenSinceKill = true;

  console.log(
    `[PVP] ${attacker.name} hit ${target.name} for ${dealtDamage} damage`
  );

  if (target.hp <= 0) {
    const attackerAchievements = getAchievementData(attacker);
    attackerAchievements.stats.pvpKills = (attackerAchievements.stats.pvpKills || 0) + 1;
    setAchievementProgress(attacker, "first_blood", attackerAchievements.stats.pvpKills);
    setAchievementProgress(attacker, "fighter", attackerAchievements.stats.pvpKills);
    setAchievementProgress(attacker, "warrior", attackerAchievements.stats.pvpKills);
    setAchievementProgress(attacker, "champion", attackerAchievements.stats.pvpKills);
    setAchievementProgress(attacker, "pvp_master", attackerAchievements.stats.pvpKills);
    if (!attacker.damageTakenSinceKill) {
      awardAchievement(attacker, "untouchable");
    }
    if (attacker.hp === 1) {
      awardAchievement(attacker, "close_call");
    }
    if (target.lastKilledBy === attacker.id) {
      awardAchievement(attacker, "revenge");
    }
    if (Date.now() - attacker.lastKillAt <= 10000) {
      awardAchievement(attacker, "double_kill");
    }
    attacker.lastKillAt = Date.now();
    attacker.damageTakenSinceKill = false;
    attacker.kills = (attacker.kills || 0) + 1;
    attacker.wantedLevel = Math.min(5, attacker.wantedLevel + 1);
    attacker.bounty += 25 + Math.floor(attacker.score / 1000) * 5;

    const bountyReward = (target.bounty || 0) + (target.wantedLevel || 0) * 10;
    if (bountyReward > 0) {
      addCoins(attacker, bountyReward);
      io.emit("chat", {
        name: "SERVER",
        message: `🎯 ${attacker.name} claimed ${bountyReward} coins in bounty from ${target.name}!`,
      });
    }

    const droppedCoins = Math.min(50, Math.floor(target.score * 0.1));
    if (droppedCoins > 0) {
      target.score -= droppedCoins;
      const droppedCoinId = crypto.randomBytes(6).toString("hex");
      coins[droppedCoinId] = {
        id: droppedCoinId,
        x: target.x,
        y: target.y,
        value: droppedCoins,
        createdAt: Date.now(),
      };
    }

    if (target.confusedUntil > Date.now()) {
      awardAchievement(target, "one_job");
    }
    target.trollFallVelocity = 0;
    target.lastLaunchedAt = 0;
    target.trollType = null;
    target.rainUntil = 0;
    target.lastKilledBy = attacker.id;
    target.hp = getClassStats(target).maxHp;
    target.bounty = 0;
    target.wantedLevel = 0;
    target.powerUpUntil = {};
    target.damageTakenSinceKill = false;

    io.emit("chat", {
      name: "SERVER",
      message: `⚔️ ${target.name} was defeated by ${attacker.name}!`,
    });

    if (activeArena?.alive.has(target.id)) {
      activeArena.alive.delete(target.id);
      target.arenaSessionId = null;
      const respawnAngle = Math.random() * Math.PI * 2;
      target.x = 100 + Math.cos(respawnAngle) * 50;
      target.y = 100 + Math.sin(respawnAngle) * 50;
      if (activeArena.alive.size <= 1) {
        finishArena(activeArena.alive.values().next().value || null);
      }
    } else {
      target.x = 400;
      target.y = 300;
    }
  }

  io.emit("players", players);
  io.emit("coins", coins);
  broadcastWorldState();
});
  socket.on("chat", (message) => {

    const currentPlayer = players[playerId];

    if (!currentPlayer) {
      return;
    }

    const cleanMessage = String(message ?? "").slice(0, 200).trim();

    if (!cleanMessage) {
      return;
    }

    if (cleanMessage.startsWith("/")) {
      const [commandToken, ...args] = cleanMessage.split(/\s+/);
      const command = commandToken.toLowerCase();
      const account = accounts[currentPlayer.name];
      const isAdmin = Boolean(account && account.admin);

      const trollCommands = [
        "/freeze", "/launch", "/speed", "/giant", "/tiny", "/spin",
        "/fakeban", "/fakekick", "/rain", "/swap", "/randomtp",
        "/gravity", "/confuse", "/jumpscare", "/fakecoins",
      ];
      if (trollCommands.includes(command)) {
        if (!currentPlayer.trollcmds) {
          socket.emit("chat", {
            name: "SERVER",
            message: "Unlock Troll Commands in the shop for 100,000 coins first.",
          });
          return;
        }

        const now = Date.now();
        const lastUsed = lastTrollCommandAt.get(playerId) || 0;
        if (now - lastUsed < 1500) {
          socket.emit("chat", { name: "SERVER", message: "Wait a moment before using another troll command." });
          return;
        }

        if (command === "/swap") {
          const first = findOnlinePlayer(args[0]);
          const second = findOnlinePlayer(args[1]);
          if (!first || !second || first.id === second.id || !first.pvp || !second.pvp) {
            socket.emit("chat", {
              name: "SERVER",
              message: "Usage: /swap <PvP player> <PvP player>; both must be online with PvP enabled.",
            });
            return;
          }
          [first.x, second.x] = [second.x, first.x];
          [first.y, second.y] = [second.y, first.y];
          pendingPlayerMoves.set(first.id, { id: first.id, x: first.x, y: first.y });
          pendingPlayerMoves.set(second.id, { id: second.id, x: second.x, y: second.y });
          awardAchievement(first, "identity_crisis");
          awardAchievement(second, "identity_crisis");
          recordTrollCommand(currentPlayer, first, "swap");
          recordTrollCommand(currentPlayer, second, "swap", false);
          lastTrollCommandAt.set(playerId, now);
          socket.emit("chat", { name: "SERVER", message: `Swapped ${first.name} and ${second.name}.` });
          return;
        }

        const target = findOnlinePlayer(args[0]);
        if (!target || !target.pvp) {
          socket.emit("chat", {
            name: "SERVER",
            message: "Choose an online player who has PvP enabled.",
          });
          return;
        }

        let duration = 10000;
        let value;
        switch (command) {
          case "/freeze":
            duration = 5000;
            target.frozenUntil = now + duration;
            sendTrollEffect(target, "freeze", duration);
            break;
          case "/launch":
            target.trollFallVelocity = -18;
            target.lastLaunchedAt = now;
            if (target.gravityUntil <= now) {
              target.gravityAmount = 1;
            }
            break;
          case "/speed":
            value = Number(args[1]);
            if (!Number.isInteger(value) || value < 1 || value > 30) {
              socket.emit("chat", { name: "SERVER", message: "Usage: /speed <PvP player> <amount 1-30>" });
              return;
            }
            target.speedBoost = value;
            target.speedBoostUntil = now + duration;
            break;
          case "/giant":
          case "/tiny":
          case "/spin":
            if (command === "/giant" || command === "/tiny") {
              target.trollType = command.slice(1);
              target.trollTypeUntil = now + duration;
            }
            sendTrollEffect(target, command.slice(1), duration);
            break;
          case "/fakeban":
            target.fakeBansReceived += 1;
            addAchievementProgress(target, "trust_issues");
            sendTrollEffect(target, "message", 4000, "⚠ You have been banned! (just kidding)");
            break;
          case "/fakekick":
            sendTrollEffect(target, "message", 4000, "⚠ Connection lost! (just kidding)");
            break;
          case "/rain":
            target.rainUntil = now + 3000;
            target.rainAwarded = false;
            sendTrollEffect(target, "rain", 3000);
            break;
          case "/randomtp":
            target.randomTeleports += 1;
            addAchievementProgress(target, "floor_is_gone");
            target.x = Math.floor(Math.random() * 1800) + 100;
            target.y = Math.floor(Math.random() * 900) + 100;
            pendingPlayerMoves.set(target.id, { id: target.id, x: target.x, y: target.y });
            break;
          case "/gravity":
            value = Number(args[1]);
            if (!Number.isFinite(value) || value < 0.1 || value > 5) {
              socket.emit("chat", { name: "SERVER", message: "Usage: /gravity <PvP player> <amount 0.1-5>" });
              return;
            }
            target.gravityAmount = value;
            target.gravityUntil = now + 15000;
            target.trollType = "gravity";
            target.trollTypeUntil = now + 15000;
            if (value >= 3 && target.trollFallVelocity === 0) {
              target.trollFallVelocity = 1;
            }
            break;
          case "/confuse":
            target.confusedUntil = now + duration;
            sendTrollEffect(target, "confuse", duration);
            break;
          case "/jumpscare":
            sendTrollEffect(target, "jumpscare", 2500);
            break;
          case "/fakecoins":
            value = Number(args[1]);
            if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000) {
              socket.emit("chat", { name: "SERVER", message: "Usage: /fakecoins <PvP player> <amount 0-1000000000>" });
              return;
            }
            sendTrollEffect(target, "message", 4000, `🪙 Your balance is now ${value} coins! (fake)`);
            break;
        }

        recordTrollCommand(currentPlayer, target, command.slice(1));
        lastTrollCommandAt.set(playerId, now);
        socket.emit("chat", {
          name: "SERVER",
          message: `${command} used on ${target.name}${value !== undefined ? ` (${value})` : ""}.`,
        });
        return;
      }

      const adminCommands = [
        "/kick", "/give", "/setcoins", "/tp",
        "/mute", "/tempmute", "/unmute",
        "/ban", "/tempban", "/unban",
      ];
      if (adminCommands.includes(command)) {
        if (!isAdmin) {
          socket.emit("chat", {
            name: "SERVER",
            message: "You are not an admin.",
          });
          return;
        }

        const targetName = args[0];

        if (!targetName) {
          socket.emit("chat", {
            name: "SERVER",
            message: `Usage: ${command} <player>${command === "/tempmute" || command === "/tempban" ? " <duration>" : ""}`,
          });
          return;
        }

        const moderationAction = {
          "/mute": "muted",
          "/tempmute": "muted",
          "/unmute": "muted",
          "/ban": "banned",
          "/tempban": "banned",
          "/unban": "banned",
        }[command];

        if (moderationAction) {
          const targetAccountName = findAccountName(targetName);
          const targetAccount = targetAccountName ? accounts[targetAccountName] : null;
          if (!targetAccount) {
            socket.emit("chat", {
              name: "SERVER",
              message: "No account found for that player.",
            });
            return;
          }

          if (command === "/unmute" || command === "/unban") {
            clearModeration(targetAccount, moderationAction);
            saveAccounts(accounts);
            socket.emit("chat", {
              name: "SERVER",
              message: `${targetAccountName} has been ${command === "/unmute" ? "unmuted" : "unbanned"}.`,
            });
            return;
          }

          const isTemporary = command === "/tempmute" || command === "/tempban";
          const duration = isTemporary ? parseDuration(args[1]) : null;
          if (isTemporary && duration === null) {
            socket.emit("chat", {
              name: "SERVER",
              message: `Usage: ${command} <player> <duration> [reason] (e.g. 30m, 2h, 7d)`,
            });
            return;
          }

          const reason = args.slice(isTemporary ? 2 : 1).join(" ").slice(0, 200);
          targetAccount[moderationAction] = true;
          targetAccount[`${moderationAction}Until`] = isTemporary ? Date.now() + duration : 0;
          targetAccount[`${moderationAction}Reason`] = reason;
          saveAccounts(accounts);

          const onlineTargets = Object.values(players).filter(
            (playerEntry) => playerEntry.name.toLowerCase() === targetAccountName.toLowerCase()
          );
          if (moderationAction === "banned") {
            for (const onlineTarget of onlineTargets) {
              const targetSocket = io.sockets.sockets.get(onlineTarget.socketId);
              if (targetSocket) {
                targetSocket.emit("chat", {
                  name: "SERVER",
                  message: reason ? `You were banned: ${reason}` : "You were banned.",
                });
                targetSocket.disconnect(true);
              }
            }
          } else {
            for (const onlineTarget of onlineTargets) {
              io.to(onlineTarget.socketId).emit("chat", {
                name: "SERVER",
                message: reason ? `You were muted: ${reason}` : "You were muted.",
              });
            }
          }

          const actionName = moderationAction === "banned" ? "banned" : "muted";
          socket.emit("chat", {
            name: "SERVER",
            message: `${targetAccountName} has been ${isTemporary ? "temporarily " : ""}${actionName}${isTemporary ? ` for ${args[1]}` : ""}.`,
          });
          return;
        }

        const target = Object.values(players).find(
          (playerEntry) => playerEntry.name.toLowerCase() === targetName.toLowerCase()
        );

        if (!target) {
          socket.emit("chat", {
            name: "SERVER",
            message: "Player is not online.",
          });
          return;
        }

        if (command === "/kick") {
          const targetSocket = io.sockets.sockets.get(target.socketId);

          if (targetSocket) {
            targetSocket.emit("chat", {
              name: "SERVER",
              message: "You were kicked by an admin.",
            });
            targetSocket.disconnect(true);
          }

          socket.emit("chat", {
            name: "SERVER",
            message: `${target.name} was kicked.`,
          });
          return;
        }

        if (command === "/give") {
          const amount = Number(args[1]);

          if (!Number.isInteger(amount) || amount <= 0) {
            socket.emit("chat", {
              name: "SERVER",
              message: "Usage: /give <player> <amount>",
            });
            return;
          }

          target.score += amount;
          checkCoinBalanceAchievements(target);
          savePlayerAccount(target);
          io.emit("players", players);
          socket.emit("chat", {
            name: "SERVER",
            message: `Gave ${amount} coins to ${target.name}`,
          });
          return;
        }

        if (command === "/setcoins") {
          const amount = Number(args[1]);

          if (!Number.isInteger(amount) || amount < 0) {
            socket.emit("chat", {
              name: "SERVER",
              message: "Usage: /setcoins <player> <amount>",
            });
            return;
          }

          target.score = amount;
          checkCoinBalanceAchievements(target);
          savePlayerAccount(target);
          io.emit("players", players);
          socket.emit("chat", {
            name: "SERVER",
            message: `${target.name} now has ${amount} coins.`,
          });
          return;
        }

        if (command === "/tp") {
          currentPlayer.x = target.x;
          currentPlayer.y = target.y;
          io.emit("players", players);
          socket.emit("chat", {
            name: "SERVER",
            message: `Teleported to ${target.name}`,
          });
          return;
        }
      }

      if (command === "/admin") {
        if (!isAdmin) {
          socket.emit("chat", {
            name: "SERVER",
            message: "You are not an admin.",
          });
          return;
        }

        socket.emit("chat", {
          name: "SERVER",
          message: "Admin commands: /kick /give /setcoins /tp /mute /tempmute /unmute /ban /tempban /unban. Temporary duration: 30s, 10m, 2h, 7d.",
        });
        return;
      }

      if (command === "/trollhelp") {
        if (!currentPlayer.trollcmds) {
          socket.emit("chat", {
            name: "SERVER",
            message: "Unlock Troll Commands in the shop for 100,000 coins first.",
          });
          return;
        }

        socket.emit("chat", {
          name: "SERVER",
          message: "/freeze /launch /speed <player> <1-30> /giant /tiny /spin /fakeban /fakekick /rain /swap <player1> <player2> /randomtp /gravity <player> <0.1-5> /confuse /jumpscare /fakecoins <player> <amount>. Targets need PvP enabled.",
        });
        return;
      }

      if (command === "/pvp") {
  currentPlayer.pvp = !currentPlayer.pvp;

  socket.emit("chat", {
    name: "SERVER",
    message: currentPlayer.pvp
      ? "⚔️ PvP enabled!"
      : "🛡️ PvP disabled!",
  });

  io.emit("players", players);
  return;
}

      if (command === "/help") {
        socket.emit("chat", {
          name: "SERVER",
        });
        return;
      }

      if (command === "/players") {
        const onlinePlayers = Object.values(players).filter((playerEntry) => playerEntry.connected);
        socket.emit("chat", {
          name: "SERVER",
          message: `Online: ${onlinePlayers.map((playerEntry) => playerEntry.name).join(", ") || "None"}`,
        });
        return;
      }

      if (command === "/coins") {
        socket.emit("chat", {
          name: "SERVER",
          message: `You have ${currentPlayer.score} 🪙 coins!`,
        });
        return;
      }

      socket.emit("chat", {
        name: "SERVER",
        message: "Unknown command. Type /help",
      });
      return;
    }

    const currentAccount = accounts[currentPlayer.name];
    if (currentAccount && getModerationStatus(currentAccount).muted) {
      const until = currentAccount.mutedUntil;
      socket.emit("chat", {
        name: "SERVER",
        message: until
          ? `You are muted until ${new Date(until).toLocaleString()}.${currentAccount.mutedReason ? ` Reason: ${currentAccount.mutedReason}` : ""}`
          : `You are permanently muted.${currentAccount.mutedReason ? ` Reason: ${currentAccount.mutedReason}` : ""}`,
      });
      return;
    }

    console.log(`[CHAT] ${currentPlayer.name}: ${cleanMessage}`);
    io.emit("chat", {
      name: currentPlayer.name,
      message: cleanMessage,
    });
  });

  socket.on("disconnect", () => {
    const currentPlayer = players[playerId];

    if (!currentPlayer) {
      return;
    }

    currentPlayer.connected = false;
    lastPlayerZoneTick.delete(playerId);
    currentPlayer.rainUntil = 0;
    currentPlayer.trollType = null;
    currentPlayer.frozenUntil = 0;
    currentPlayer.speedBoostUntil = 0;
    currentPlayer.confusedUntil = 0;
    currentPlayer.gravityUntil = 0;
    savePlayerAccount(currentPlayer);
    arenaQueue.delete(playerId);
    if (activeArena?.alive.has(playerId)) {
      activeArena.alive.delete(playerId);
      if (activeArena.alive.size <= 1) {
        finishArena(activeArena.alive.values().next().value || null);
      }
    }
    if (arenaQueue.size < 2 && arenaStartTimer) {
      clearTimeout(arenaStartTimer);
      arenaStartTimer = null;
    }
    publishArenaStatus();
    console.log(`[DISCONNECT] ${currentPlayer.name}`);

    setTimeout(() => {
      const latest = players[playerId];

      if (!latest) {
        return;
      }

      if (!latest.connected) {
        pendingPlayerMoves.delete(playerId);
        console.log(`[LEAVE] ${latest.name}`);
        delete players[playerId];
        io.emit("players", players);
      }
    }, 30000);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const consoleCommands = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

consoleCommands.on("line", (line) => {
  const [command, username] = line.trim().split(/\s+/, 2);
  if (!command) {
    return;
  }

  if (command.toLowerCase() === "help") {
    console.log("Server console commands: unban <username>, unadmin <username>");
    return;
  }

  if (command.toLowerCase() !== "unban" && command.toLowerCase() !== "unadmin") {
    console.log("Unknown console command. Type help.");
    return;
  }

  const accountName = findAccountName(username);
  if (!accountName) {
    console.log("No account found for that username.");
    return;
  }

  const account = accounts[accountName];
  if (command.toLowerCase() === "unban") {
    clearModeration(account, "banned");
  } else {
    account.admin = false;
  }
  saveAccounts(accounts);
  console.log(`${accountName} ${command.toLowerCase() === "unban" ? "unbanned" : "removed as admin"}.`);
});
