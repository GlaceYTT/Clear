const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const mongoose = require('mongoose');
const config = require('./config');
const UserActivity = require('./models/UserActivity');
require('dotenv').config();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

connectToMongoDB();

function connectToMongoDB() {
  console.log('Attempting to connect to MongoDB...');
  mongoose.connect(config.mongoURI)
    .then(() => console.log('✅ Connected to MongoDB successfully'))
    .catch(err => {
      console.error('❌ MongoDB connection error:', err);
      console.log('Retrying MongoDB connection in 5 seconds...');
      setTimeout(connectToMongoDB, 5000);
    });
}

mongoose.connection.on('disconnected', () => {
  console.log('❌ MongoDB disconnected! Attempting to reconnect...');
  connectToMongoDB();
});

process.on('SIGINT', async () => {
  console.log('Shutting down bot gracefully...');
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
    client.destroy();
    console.log('Discord client destroyed.');
    process.exit(0);
  } catch (err) {
    console.error('Error during graceful shutdown:', err);
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

client.once('ready', () => {
  console.log(`🤖 Bot is online as ${client.user.tag}`);
  console.log(`📊 Monitoring ${config.servers.filter(s => s.status).length} active servers`);
  
  config.servers.forEach(server => {
    const status = server.status ? 'ACTIVE' : 'INACTIVE';
    console.log(`Server ${server.id}: ${status} (${server.duration} minutes inactivity threshold)`);
  });
  
  console.log('⏱️ Starting inactive user check schedule (every 5 minutes)');
  // Changed to check every 5 minutes instead of hourly
  setInterval(checkInactiveUsers, 5 * 60 * 1000); 
  
  setTimeout(() => {
    console.log('🔍 Running initial inactive user check...');
    checkInactiveUsers();
  }, 5 * 60 * 1000);

  async function updateBotStatus() {
    try {
      let totalMembers = 0;
      
      for (const serverConfig of config.servers.filter(s => s.status)) {
        const guild = client.guilds.cache.get(serverConfig.id);
        if (guild) {
          try {
            if (guild.members.cache.size === 0) {
              await guild.members.fetch();
            }
            totalMembers += guild.memberCount;
          } catch (err) {
            console.error(`Error fetching members for ${guild.name}:`, err);
            totalMembers += guild.memberCount; 
          }
        }
      }
      
      client.user.setPresence({
        activities: [{ 
          name: `${totalMembers} members`, 
          type: 3 
        }],
        status: 'online'
      });
      
      console.log(`🔄 Status updated: Watching ${totalMembers} members`);
    } catch (error) {
      console.error('❌ Error updating status:', error);
    }
  }
  
  console.log('🔍 Starting initial member tracking...');
  setTimeout(() => trackAllExistingMembers(), 10000);
  updateBotStatus();
});

async function trackAllExistingMembers() {
    console.log('🔄 Starting to track all existing members...');
    const activeServers = config.servers.filter(server => server.status);
    
    for (const serverConfig of activeServers) {
      try {
        const guild = client.guilds.cache.get(serverConfig.id);
        if (!guild) continue;
        
        console.log(`📋 Tracking members in: ${guild.name} (${guild.id})`);
        
        try {
          await guild.members.fetch();
          console.log(`✅ Successfully fetched ${guild.members.cache.size} members in ${guild.name}`);
        } catch (fetchError) {
          console.error(`❌ Failed to fetch members in ${guild.name}:`, fetchError);
          continue;
        }
        
        const membersToTrack = guild.members.cache.filter(member => 
          !member.user.bot && shouldCheckMember(member, serverConfig)
        );
        
        console.log(`👥 Found ${membersToTrack.size} members to track in ${guild.name}`);
        
        let trackCount = 0;
        for (const member of membersToTrack.values()) {
          try {
            const existingRecord = await UserActivity.findOne({
              userId: member.id,
              guildId: guild.id
            });
            
            if (!existingRecord) {
              await UserActivity.create({
                userId: member.id,
                guildId: guild.id,
                lastActivity: new Date() 
              });
              trackCount++;
            }
          } catch (memberError) {
            console.error(`❌ Error tracking member ${member.user.tag}:`, memberError);
          }
        }
        
        console.log(`✅ Added ${trackCount} new members to tracking database in ${guild.name}`);
        
      } catch (guildError) {
        console.error(`❌ Error processing guild tracking:`, guildError);
      }
    }
    
    console.log('✅ Completed tracking all existing members');
  }
  
  client.on('guildMemberAdd', async (member) => {
    try {
      const guildConfig = config.servers.find(server => server.id === member.guild.id);
      if (!guildConfig || !guildConfig.status) return;
      
      if (shouldCheckMember(member, guildConfig)) {
        await UserActivity.findOneAndUpdate(
          { userId: member.id, guildId: member.guild.id },
          { lastActivity: new Date() },
          { upsert: true, new: true }
        );
        console.log(`👤 New member tracked: ${member.user.tag} in ${member.guild.name}`);
      }
    } catch (error) {
      console.error(`❌ Error tracking new member ${member.user.tag}:`, error);
    }
  });
  
  client.on('guildCreate', async (guild) => {
    console.log(`🎉 Bot joined a new server: ${guild.name} (${guild.id})`);
    
    const guildConfig = config.servers.find(server => server.id === guild.id);
    if (!guildConfig || !guildConfig.status) {
      console.log(`⚠️ Server ${guild.name} is not in active configuration, skipping member tracking`);
      return;
    }
    
    try {
      await guild.members.fetch();
      
      const membersToTrack = guild.members.cache.filter(member => 
        !member.user.bot && shouldCheckMember(member, guildConfig)
      );
      
      console.log(`👥 Found ${membersToTrack.size} members to track in new server ${guild.name}`);
      
      let trackCount = 0;
      for (const member of membersToTrack.values()) {
        try {
          await UserActivity.findOneAndUpdate(
            { userId: member.id, guildId: guild.id },
            { lastActivity: new Date() },
            { upsert: true, new: true }
          );
          trackCount++;
        } catch (memberError) {
          console.error(`❌ Error tracking member in new server:`, memberError);
        }
      }
      
      console.log(`✅ Added ${trackCount} members to tracking in new server ${guild.name}`);
    } catch (error) {
      console.error(`❌ Error tracking members in new server ${guild.name}:`, error);
    }
  });

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  const guildConfig = config.servers.find(server => server.id === message.guild.id);
  if (!guildConfig || !guildConfig.status) return;
  
  try {
    await UserActivity.findOneAndUpdate(
      { userId: message.author.id, guildId: message.guild.id },
      { lastActivity: new Date() },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error(`❌ Error updating activity for user ${message.author.tag}:`, error);
  }
});

async function checkInactiveUsers() {
  console.log('🔄 Starting inactive user check...');
  const activeServers = config.servers.filter(server => server.status);
  let totalChecked = 0;
  let totalKicked = 0;
  
  for (const serverConfig of activeServers) {
    try {
      const guild = client.guilds.cache.get(serverConfig.id);
      if (!guild) {
        console.log(`⚠️ Guild ${serverConfig.id} not found or bot doesn't have access`);
        continue;
      }
      
      console.log(`📋 Checking server: ${guild.name} (${guild.id})`);
      
      try {
        let membersLoaded = false;
        let retryCount = 0;
        
        while (!membersLoaded && retryCount < 3) {
          try {
            await guild.members.fetch();
            membersLoaded = true;
          } catch (fetchError) {
            retryCount++;
            console.error(`⚠️ Failed to fetch members (attempt ${retryCount}/3):`, fetchError);
            if (retryCount < 3) await new Promise(r => setTimeout(r, 5000)); 
          }
        }
        
        if (!membersLoaded) {
          console.error(`❌ Could not fetch members for ${guild.name} after 3 attempts, skipping...`);
          continue;
        }
        
        const members = guild.members.cache.filter(member => 
          !member.user.bot && shouldCheckMember(member, serverConfig)
        );
        
        console.log(`👥 Found ${members.size} members to check in ${guild.name}`);
        totalChecked += members.size;
        
        let serverKickCount = 0;
        for (const member of members.values()) {
          try {
            const userActivity = await UserActivity.findOne({
              userId: member.id,
              guildId: guild.id
            });
            
            // Changed from days to minutes
            const inactiveThreshold = serverConfig.duration * 60 * 1000; // duration in minutes * milliseconds
            
            const now = new Date();
            const lastActive = userActivity ? userActivity.lastActivity : null;
            
            if (!lastActive || (now - lastActive) > inactiveThreshold) {
              const kicked = await kickInactiveMember(member, guild, serverConfig, lastActive);
              if (kicked) serverKickCount++;
            }
          } catch (memberError) {
            console.error(`❌ Error checking member ${member.user.tag}:`, memberError);
          }
        }
        
        console.log(`👢 Kicked ${serverKickCount} members from ${guild.name}`);
        totalKicked += serverKickCount;
        
      } catch (guildError) {
        console.error(`❌ Error processing guild ${guild.name}:`, guildError);
      }
    } catch (serverError) {
      console.error(`❌ Error with server config ${serverConfig.id}:`, serverError);
    }
  }
  
  console.log(`✅ Inactive user check complete. Checked ${totalChecked} members, kicked ${totalKicked} members.`);
}

function shouldCheckMember(member, serverConfig) {
  try {
    console.log(`🔍 Checking roles for member: ${member.user.tag} (${member.id})`);
    const memberRoles = member.roles.cache.map(role => role.id);
    console.log(`👤 Member has roles: ${memberRoles.join(', ')}`);
    console.log(`🛡️ Safe roles: ${serverConfig.safeRoles.join(', ')}`);
    console.log(`⚠️ Non-safe roles: ${serverConfig.nonSafeRoles.join(', ')}`);
    
    // Check if user has any safe role (after trimming whitespace)
    const safeRoles = serverConfig.safeRoles.map(role => role.trim());
    const hasSafeRole = memberRoles.some(roleId => safeRoles.includes(roleId));
    
    if (hasSafeRole) {
      const safeRole = memberRoles.find(roleId => safeRoles.includes(roleId));
      console.log(`✅ User ${member.user.tag} has safe role: ${safeRole}, skipping inactivity check`);
      return false; // Skip if user has any safe role
    } else {
      console.log(`❌ User ${member.user.tag} has no safe roles`);
    }
    
    // Check if they have any non-safe role that should be checked
    const nonSafeRoles = serverConfig.nonSafeRoles.map(role => role.trim());
    const hasNonSafeRole = memberRoles.some(roleId => nonSafeRoles.includes(roleId));
    
    if (hasNonSafeRole) {
      const nonSafeRole = memberRoles.find(roleId => nonSafeRoles.includes(roleId));
      console.log(`⚠️ User ${member.user.tag} has non-safe role: ${nonSafeRole}, will check for inactivity`);
      return true; // Check this member for inactivity
    } else {
      console.log(`🔄 User ${member.user.tag} has no monitored non-safe roles, skipping inactivity check`);
      return false; // Skip if they don't have any of the specified non-safe roles
    }
  } catch (error) {
    console.error(`❌ Error checking roles for member ${member?.user?.tag || 'unknown'}:`, error);
    return false; // Skip this member if there's an error
  }
}

async function kickInactiveMember(member, guild, serverConfig, lastActive) {
  try {
    // Changed from days to minutes
    const inactiveMinutes = lastActive ? 
      Math.floor((new Date() - lastActive) / (60 * 1000)) : 
      serverConfig.duration;
    
    console.log(`⏱️ Member ${member.user.tag} inactive for ${inactiveMinutes} minutes`);
    
    try {
      await member.send({
        content: `You have been removed from **${guild.name}** for inactivity (${inactiveMinutes} ${inactiveMinutes === 1 ? 'minute' : 'minutes'} since last message).`
      });
      console.log(`📧 Successfully sent DM to ${member.user.tag}`);
    } catch (dmError) {
      console.log(`📧 Could not DM ${member.user.tag}: ${dmError.message}`);
    }

    let kickSuccess = false;
    let kickAttempts = 0;
    
    while (!kickSuccess && kickAttempts < 3) {
      try {
        await member.kick(`Inactivity: ${inactiveMinutes} minutes without a message`);
        kickSuccess = true;
      } catch (kickError) {
        kickAttempts++;
        console.error(`⚠️ Failed to kick ${member.user.tag} (attempt ${kickAttempts}/3):`, kickError);
        if (kickAttempts < 3) await new Promise(r => setTimeout(r, 2000)); 
      }
    }
    
    if (!kickSuccess) {
      console.error(`❌ Failed to kick ${member.user.tag} after 3 attempts`);
      return false;
    }
    
    try {
      const logChannel = guild.channels.cache.get(serverConfig.logChannelId);
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setColor('#ff4040')
          .setTitle('Member Auto-Kicked')
          .setThumbnail(member.user.displayAvatarURL())
          .addFields(
            { name: 'User', value: `${member.user.tag} (${member.id})` },
            { name: 'Reason', value: `Inactivity: ${inactiveMinutes} minutes without a message` },
            { name: 'Last Active', value: lastActive ? `<t:${Math.floor(lastActive.getTime() / 1000)}:F>` : 'Never active' }
          )
          .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
        console.log(`📝 Kick logged in channel #${logChannel.name}`);
      } else {
        console.log(`⚠️ Log channel ${serverConfig.logChannelId} not found`);
      }
    } catch (logError) {
      console.error(`❌ Error logging kick:`, logError);
    }
    
    try {
      await UserActivity.findOneAndDelete({
        userId: member.id,
        guildId: guild.id
      });
      console.log(`🗑️ Removed activity record for ${member.user.tag}`);
    } catch (deleteError) {
      console.error(`❌ Error deleting activity record:`, deleteError);
    }
    
    console.log(`👢 Successfully kicked ${member.user.tag} from ${guild.name} for ${inactiveMinutes} minutes of inactivity`);
    return true;
  } catch (error) {
    console.error(`❌ Error in kick process for ${member.user.tag}:`, error);
    return false;
  }
}

function loginBot() {
  console.log('Attempting to login to Discord...');
  client.login(process.env.TOKEN)
    .catch(err => {
      console.error('❌ Discord login error:', err);
      console.log('Retrying Discord login in 5 seconds...');
      setTimeout(loginBot, 5000);
    });
}

const path = require('path');
const express = require("express");
const app = express();
const port = 3000;
app.get('/', (req, res) => {
    const imagePath = path.join(__dirname, 'index.html');
    res.sendFile(imagePath);
});
app.listen(port, () => {
    console.log(`🔗 Listening to GlaceYT : http://localhost:${port}`);
});

loginBot();

client.on('shardDisconnect', (event, shardID) => {
  console.log(`❌ Bot disconnected from Discord (Shard ID: ${shardID}). Reason: ${event.reason}`);
  console.log('Bot will automatically attempt to reconnect...');
});

client.on('shardReconnecting', (shardID) => {
  console.log(`🔄 Bot reconnecting to Discord (Shard ID: ${shardID})...`);
});

client.on('shardResume', (shardID, replayedEvents) => {
  console.log(`✅ Bot reconnected to Discord (Shard ID: ${shardID}). Replayed ${replayedEvents} events.`);
});
