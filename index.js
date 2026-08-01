const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

// --- CONFIGURATION ---
const TOKEN = "";
const CLIENT_ID = "1533121459680186408";

// Replace these with your actual Discord Role IDs
const ROLE_STANDARD_GIVER = "1533122414043730185";
const ROLE_UNLIMITED_GIVER = "1533122738896638002";
const ROLE_ADMIN_BLACKLIST = "1523941151516790887";
const LOG_CHANNEL_ID = "1523960557416218744";
// ---------------------

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// Data tracking
const weeklyActions = new Map(); // { userId: { count, resetTime } }
const blacklistedRoles = new Set(); // Set of blacklisted role IDs
const activeSessions = new Map(); // { userId: { action, targetUserId, targetRoleId } }

client.once('ready', async () => {
    console.log(`[Role Bot] Logged in successfully as ${client.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        const commands = [
            new SlashCommandBuilder().setName('role').setDescription('Open the modern role management portal'),
            new SlashCommandBuilder().setName('brpb').setDescription('Open the advanced bulk blacklist manager')
        ];

        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('[Role Bot] Slash commands registered successfully!');
    } catch (error) {
        console.error('[Role Bot Error]:', error);
    }
});

client.on('interactionCreate', async interaction => {
    const member = interaction.member;

    // 1. HANDLE /ROLE COMMAND (Modernized Sleek Embed Hub)
    if (interaction.isChatInputCommand() && interaction.commandName === 'role') {
        const isStandard = member.roles.cache.has(ROLE_STANDARD_GIVER);
        const isUnlimited = member.roles.cache.has(ROLE_UNLIMITED_GIVER);
        const isAdmin = member.roles.cache.has(ROLE_ADMIN_BLACKLIST);

        if (!isStandard && !isUnlimited && !isAdmin) {
            return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
        }

        let quotaDescription = "• **Access Tier:** Unlimited (No Quota Restrictions)";
        if (isStandard && !isUnlimited && !isAdmin) {
            const now = Date.now();
            let userData = weeklyActions.get(member.id);
            const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

            if (!userData || now > userData.resetTime) {
                userData = { count: 0, resetTime: now + ONE_WEEK };
                weeklyActions.set(member.id, userData);
            }

            const remaining = Math.max(0, 10 - userData.count);
            quotaDescription = `• **Weekly Quota:** **${remaining} / 10** uses remaining`;
        }

        const modernEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🛡️ Role Management Center')
            .setDescription('Select an operation below to assign or revoke server roles safely and efficiently.')
            .addFields(
                { name: '📊 Your Permissions', value: quotaDescription, inline: false }
            )
            .setFooter({ text: 'StrapSecure Security Systems', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('start_give_role').setLabel('Give Role').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('start_remove_role').setLabel('Remove Role').setStyle(ButtonStyle.Danger).setEmoji('➖')
        );

        return interaction.reply({
            embeds: [modernEmbed],
            components: [row],
            ephemeral: true
        });
    }

    // 2. HANDLE BUTTON CLICKS (Give / Remove Selection)
    if (interaction.isButton() && (interaction.customId === 'start_give_role' || interaction.customId === 'start_remove_role')) {
        const actionType = interaction.customId === 'start_give_role' ? 'give' : 'remove';
        activeSessions.set(member.id, { action: actionType });

        const userSelect = new UserSelectMenuBuilder()
            .setCustomId('select_target_user')
            .setPlaceholder('📌 Step 1: Choose target user');

        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId('select_target_role')
            .setPlaceholder('📌 Step 2: Choose target role');

        const stepEmbed = new EmbedBuilder()
            .setColor(actionType === 'give' ? 0x57F287 : 0xED4245)
            .setTitle(`⚙️ Mode: ${actionType.toUpperCase()} ROLE`)
            .setDescription('Make your selections using the dropdown menus below to proceed.');

        return interaction.update({
            embeds: [stepEmbed],
            components: [
                new ActionRowBuilder().addComponents(userSelect),
                new ActionRowBuilder().addComponents(roleSelect)
            ]
        });
    }

    // 3. HANDLE SELECT MENUS FOR USER & ROLE (Execution Phase & Self-Assignment Prevention)
    if (interaction.isUserSelectMenu() || interaction.isRoleSelectMenu()) {
        if (interaction.customId === 'select_target_user' || interaction.customId === 'select_target_role') {
            if (!activeSessions.has(member.id)) {
                activeSessions.set(member.id, { action: 'give' });
            }
            
            if (interaction.isUserSelectMenu()) {
                activeSessions.get(member.id).targetUserId = interaction.values[0];
            }
            if (interaction.isRoleSelectMenu()) {
                activeSessions.get(member.id).targetRoleId = interaction.values[0];
            }

            const session = activeSessions.get(member.id);

            if (session.targetUserId && session.targetRoleId) {
                await interaction.deferUpdate();

                const action = session.action;
                const targetUserId = session.targetUserId;
                const roleId = session.targetRoleId;

                activeSessions.delete(member.id);

                // Prevent users from giving roles to themselves
                if (action === 'give' && targetUserId === member.id) {
                    return interaction.editReply({ content: "❌ **Security Block:** You cannot assign roles to yourself.", embeds: [], components: [] });
                }

                const isUnlimited = member.roles.cache.has(ROLE_UNLIMITED_GIVER);
                const isStandard = member.roles.cache.has(ROLE_STANDARD_GIVER);
                const isAdmin = member.roles.cache.has(ROLE_ADMIN_BLACKLIST);

                if (!isStandard && !isUnlimited && !isAdmin) {
                    return interaction.editReply({ content: "❌ You do not have permission to execute this.", embeds: [], components: [] });
                }

                if (action === 'give' && blacklistedRoles.has(roleId)) {
                    return interaction.editReply({ content: `❌ **Action Blocked:** The role <@&${roleId}> is blacklisted and cannot be assigned.`, embeds: [], components: [] });
                }

                try {
                    const guild = interaction.guild;
                    const targetMember = await guild.members.fetch(targetUserId);
                    const targetRole = await guild.roles.fetch(roleId);

                    if (!targetRole) {
                        return interaction.editReply({ content: "❌ Invalid Role selected.", embeds: [], components: [] });
                    }

                    if (!isAdmin) {
                        const executorHighestRolePosition = member.roles.highest.position;
                        if (targetRole.position >= executorHighestRolePosition) {
                            return interaction.editReply({ content: "❌ **Hierarchy Error:** You cannot manage a role that is higher than or equal to your own highest staff role.", embeds: [], components: [] });
                        }
                    }

                    if (isStandard && !isUnlimited && !isAdmin) {
                        const now = Date.now();
                        let userData = weeklyActions.get(member.id);
                        const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

                        if (!userData || now > userData.resetTime) {
                            userData = { count: 0, resetTime: now + ONE_WEEK };
                            weeklyActions.set(member.id, userData);
                        }

                        if (userData.count >= 10) {
                            return interaction.editReply({ content: "❌ **Weekly Limit Reached:** You have exhausted your 10 role modifications for this week.", embeds: [], components: [] });
                        }

                        userData.count += 1;
                    }

                    if (action === 'give') {
                        await targetMember.roles.add(targetRole);
                        
                        // Send Audit Log Embed to Channel
                        const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
                        if (logChannel) {
                            const logEmbed = new EmbedBuilder()
                                .setColor(0x57F287)
                                .setTitle('📝 Role Assigned Log')
                                .addFields(
                                    { name: 'Staff Member', value: `<@${member.id}>`, inline: true },
                                    { name: 'Target User', value: `<@${targetUserId}>`, inline: true },
                                    { name: 'Role Given', value: `<@&${roleId}>`, inline: false }
                                )
                                .setTimestamp();
                            await logChannel.send({ embeds: [logEmbed] });
                        }

                        return interaction.editReply({ content: `✅ **Success:** Successfully assigned role ${targetRole} to <@${targetUserId}>!`, embeds: [], components: [] });
                    } else if (action === 'remove') {
                        await targetMember.roles.remove(targetRole);

                        // Send Audit Log Embed to Channel
                        const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
                        if (logChannel) {
                            const logEmbed = new EmbedBuilder()
                                .setColor(0xED4245)
                                .setTitle('📝 Role Removed Log')
                                .addFields(
                                    { name: 'Staff Member', value: `<@${member.id}>`, inline: true },
                                    { name: 'Target User', value: `<@${targetUserId}>`, inline: true },
                                    { name: 'Role Removed', value: `<@&${roleId}>`, inline: false }
                                )
                                .setTimestamp();
                            await logChannel.send({ embeds: [logEmbed] });
                        }

                        return interaction.editReply({ content: `✅ **Success:** Successfully removed role ${targetRole} from <@${targetUserId}>!`, embeds: [], components: [] });
                    }
                } catch (err) {
                    console.error(err);
                    return interaction.editReply({ content: "❌ **Error:** Failed to process role modification. Ensure the bot's role is positioned above the target role.", embeds: [], components: [] });
                }
            } else {
                return interaction.reply({ content: "📌 Selection registered! Please select the remaining option to complete the action.", ephemeral: true });
            }
        }
    }

    // 4. HANDLE /BRPB COMMAND (Dashboard Hub with Blacklist & Unblock Buttons)
    if (interaction.isChatInputCommand() && interaction.commandName === 'brpb') {
        if (!member.roles.cache.has(ROLE_ADMIN_BLACKLIST)) {
            return interaction.reply({ content: "❌ You do not have the required role to use /brpb.", ephemeral: true });
        }

        let blacklistedDisplay = blacklistedRoles.size === 0 
            ? "*No roles are currently blacklisted.*" 
            : Array.from(blacklistedRoles).map(id => `🚫 <@&${id}>`).join('\n');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('brpb_open_add').setLabel('Blacklist Roles').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
            new ButtonBuilder().setCustomId('brpb_open_remove').setLabel('Remove from Blacklist').setStyle(ButtonStyle.Success).setEmoji('✅')
        );

        return interaction.reply({
            content: `🛡️ **BULK ROLE BLACKLIST MANAGEMENT PANEL**\n\n` +
                     `📋 **Currently Blacklisted Roles:**\n${blacklistedDisplay}\n\n` +
                     `*(Click a button below to choose whether you want to add or remove roles from this list)*`,
            components: [row],
            ephemeral: true
        });
    }

    // 5. HANDLE OPENING THE BLACKLIST ADD / REMOVE MENUS
    if (interaction.isButton() && (interaction.customId === 'brpb_open_add' || interaction.customId === 'brpb_open_remove')) {
        const isRemoving = interaction.customId === 'brpb_open_remove';

        if (isRemoving && blacklistedRoles.size === 0) {
            return interaction.reply({ content: "❌ There are no blacklisted roles to remove right now.", ephemeral: true });
        }

        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId(isRemoving ? 'brpb_process_remove' : 'brpb_process_add')
            .setPlaceholder(isRemoving ? 'Select blacklisted roles to unblock...' : 'Select roles to block...')
            .setMinValues(1)
            .setMaxValues(25);

        return interaction.update({
            content: isRemoving 
                ? `✅ **Unblock Roles Menu:** Select the roles below that you want to **remove** from the blacklist:`
                : `🚫 **Blacklist Roles Menu:** Select the roles below that you want to **block** from being given out:`,
            components: [new ActionRowBuilder().addComponents(roleSelect)]
        });
    }

    // 6. PROCESS BLACKLIST ADDITIONS
    if (interaction.isRoleSelectMenu() && interaction.customId === 'brpb_process_add') {
        const selectedRoles = interaction.values;
        let addedSummary = [];

        for (const roleId of selectedRoles) {
            blacklistedRoles.add(roleId);
            addedSummary.push(`🚫 Blacklisted: <@&${roleId}>`);
        }

        let blacklistedDisplay = Array.from(blacklistedRoles).map(id => `🚫 <@&${id}>`).join('\n');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('brpb_open_add').setLabel('Blacklist Roles').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
            new ButtonBuilder().setCustomId('brpb_open_remove').setLabel('Remove from Blacklist').setStyle(ButtonStyle.Success).setEmoji('✅')
        );

        return interaction.update({
            content: `🛡️ **BULK ROLE BLACKLIST MANAGEMENT PANEL**\n\n` +
                     `🔄 **Successfully Added:**\n${addedSummary.join('\n')}\n\n` +
                     `📋 **Current Blacklisted Roles:**\n${blacklistedDisplay}\n\n` +
                     `*(Click a button below to manage further)*`,
            components: [row]
        });
    }

    // 7. PROCESS BLACKLIST REMOVALS
    if (interaction.isRoleSelectMenu() && interaction.customId === 'brpb_process_remove') {
        const selectedRoles = interaction.values;
        let removedSummary = [];

        for (const roleId of selectedRoles) {
            if (blacklistedRoles.has(roleId)) {
                blacklistedRoles.delete(roleId);
                removedSummary.push(`✅ Unblocked: <@&${roleId}>`);
            }
        }

        let blacklistedDisplay = blacklistedRoles.size === 0 
            ? "*No roles are currently blacklisted.*" 
            : Array.from(blacklistedRoles).map(id => `🚫 <@&${id}>`).join('\n');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('brpb_open_add').setLabel('Blacklist Roles').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
            new ButtonBuilder().setCustomId('brpb_open_remove').setLabel('Remove from Blacklist').setStyle(ButtonStyle.Success).setEmoji('✅')
        );

        return interaction.update({
            content: `🛡️ **BULK ROLE BLACKLIST MANAGEMENT PANEL**\n\n` +
                     `🔄 **Successfully Removed:**\n${removedSummary.join('\n')}\n\n` +
                     `📋 **Current Blacklisted Roles:**\n${blacklistedDisplay}\n\n` +
                     `*(Click a button below to manage further)*`,
            components: [row]
        });
    }
});

client.login(TOKEN);