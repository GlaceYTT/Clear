// config.js
module.exports = {
    token: '',
    mongoURI: 'mongodb+srv://shiva:shiva@discordbot.opd5w.mongodb.net/?retryWrites=true&w=majority',
    servers: [
      {
        id: '1091391355261034568',
        status: true,
        logChannelId: '1366033296831807538',
        safeRoles: ['1339588497761243176 ',' 1363213365337526494',' 1096127001858945024', '1238586828479528990' , '1098005398763606108'],  // Users with these roles won't be kicked
        nonSafeRoles: ['1096142348217491547', '1096141592366174250'],  // Users with these roles will be kicked unless they have safe roles
        duration: 15  //  (e.g., 15 for 15 days)
      }
    ]
  };
