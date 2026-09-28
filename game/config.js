module.exports = {
    host: "0.0.0.0",
    port: 3000,
    logpath: "logger.php",
    foodMass: 3,
    fireFood: 20,
    limitSplit: 16,
    defaultPlayerMass: 10,
    minStartMass: 10,
    maxStartMass: 5000,
	virus: {
        fill: "#33ff33",
        stroke: "#19D119",
        strokeWidth: 20,
        defaultMass: {
            from: 100,
            to: 150
        },
        splitMass: 180,
        uniformDisposition: false,
	},
    gameWidth: 5000,
    gameHeight: 5000,
    adminPass: "DEFAULT",
    gameMass: 60000,
    maxFood: 3000,
    maxVirus: 50,
    slowBase: 4.5,
    logChat: 0,
    networkUpdateFactor: 20,
    spatialCellSize: 200,
    // Spectate ("Assistir"): não manda as ~3000 comidas — amostra pra não travar rede/CPU
    spectatorMaxFood: 450,
    forceMergeCooldownMs: 1500,
    maxHeartbeatInterval: 5000,
    foodUniformDisposition: true,
    newPlayerInitialPosition: "farthest",
    massLossRate: 1,
    minMassLoss: 50,
    sqlinfo: {
      fileName: "db.sqlite3",
    }
};
