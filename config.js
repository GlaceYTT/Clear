// config.js
module.exports = {
    token: '',
    mongoURI: 'mongodb+srv://shiva:shiva@discordbot.opd5w.mongodb.net/?retryWrites=true&w=majority',
    servers: [
      {
        id: '1091391355261034568',
        status: true,
        logChannelId: '1366033296831807538',
        safeRoles: ['1366010820756242452', 'ROLE_ID_D'],  // Users with these roles won't be kicked
        nonSafeRoles: ['1366010873352814603', 'ROLE_ID_B'],  // Users with these roles will be kicked unless they have safe roles
        duration: 15  //  (e.g., 15 for 15 days)
      }
    ]
  };