import { App } from '@rocket.chat/apps-engine/definition/App';
import {
    IAppAccessors,
    IConfigurationExtend,
    IHttp,
    ILogger,
    IMessageBuilder,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { IMessage, IPreMessageSentModify } from '@rocket.chat/apps-engine/definition/messages';
import { UserType } from '@rocket.chat/apps-engine/definition/users';

import { basicAuthHeader } from './base64';
import { JiraClient } from './jira';
import { settings } from './settings';

const DEFAULT_PATTERN = '\\b[A-Z][A-Z0-9]{1,20}-\\d+\\b';

interface AppConfig {
    baseUrl: string;
    user: string;
    token: string;
    authMode: string;
    pattern: RegExp;
    projectKeys: Set<string>;
    abbrevLength: number;
    ignoreUsers: Set<string>;
}

export class RocketJiraApp extends App implements IPreMessageSentModify {
    private jira: JiraClient | null = null;
    private jiraKey = '';

    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async extendConfiguration(configuration: IConfigurationExtend): Promise<void> {
        for (const setting of settings) {
            await configuration.settings.provideSetting(setting);
        }
    }

    public async checkPreMessageSentModify(message: IMessage, read: IRead, http: IHttp): Promise<boolean> {
        if (typeof message.text !== 'string' || message.text.trim().length === 0) {
            return false;
        }
        if (message.type) {
            return false;
        }
        if (message.editedAt || message.editor) {
            return false;
        }
        if (!message.sender || message.sender.type !== UserType.USER) {
            return false;
        }

        try {
            const config = await this.readConfig(read);
            if (config.ignoreUsers.has(message.sender.username)) {
                return false;
            }
            return config.pattern.test(message.text);
        } catch (err) {
            this.logError('config read failed', err);
            return false;
        }
    }

    public async executePreMessageSentModify(
        message: IMessage,
        builder: IMessageBuilder,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
    ): Promise<IMessage> {
        try {
            const text = message.text || '';
            const config = await this.readConfig(read);

            const matches = text.match(config.pattern) || [];
            const uniqueKeys = [...new Set(matches)];

            const lookupKeys = config.projectKeys.size > 0
                ? uniqueKeys.filter((key) => config.projectKeys.has(key.split('-')[0].toUpperCase()))
                : uniqueKeys;

            const summaries = new Map<string, string>();
            for (const key of lookupKeys) {
                const summary = await this.getJira(http, config).getSummary(key);
                if (summary !== null) {
                    summaries.set(key, summary);
                }
            }
            if (summaries.size === 0) {
                return builder.getMessage();
            }

            const newText = text.replace(config.pattern, (match) => {
                const summary = summaries.get(match);
                if (summary === undefined) {
                    return match;
                }
                return this.formatLink(match, summary, config);
            });

            if (newText !== text) {
                builder.setText(newText);
                this.getLogger().log(`[rocket-jira] rewrote ${[...summaries.keys()].join(', ')} in a ${message.room.type} room`);
            }
        } catch (err) {
            this.logError('message rewrite failed, leaving text untouched', err);
        }
        return builder.getMessage();
    }

    private async readConfig(read: IRead): Promise<AppConfig> {
        const settingsReader = read.getEnvironmentReader().getSettings();

        const baseUrl = String((await settingsReader.getValueById('jira-url')) || '').replace(/\/+$/, '');
        const user = String((await settingsReader.getValueById('jira-user')) || '');
        const token = String((await settingsReader.getValueById('jira-token')) || '');
        const authMode = String((await settingsReader.getValueById('jira-auth-mode')) || 'pat');
        const patternSource = String((await settingsReader.getValueById('issue-pattern')) || DEFAULT_PATTERN);
        const projectKeysRaw = String((await settingsReader.getValueById('project-keys')) || '');
        const abbrevLength = parseInt(String((await settingsReader.getValueById('abbrev-length')) || '40'), 10);
        const ignoreUsersRaw = String((await settingsReader.getValueById('ignore-users')) || '');

        if (!baseUrl || !user || !token) {
            throw new Error('Jira URL, username and token settings must all be configured');
        }

        return {
            baseUrl,
            user,
            token,
            authMode,
            pattern: this.compilePattern(patternSource),
            projectKeys: new Set(projectKeysRaw.split(',').map((key) => key.trim().toUpperCase()).filter(Boolean)),
            abbrevLength: Number.isNaN(abbrevLength) || abbrevLength < 1 ? 40 : abbrevLength,
            ignoreUsers: new Set(ignoreUsersRaw.split(',').map((name) => name.trim()).filter(Boolean)),
        };
    }

    private getJira(http: IHttp, config: AppConfig): JiraClient {
        const key = `${config.baseUrl}|${config.user}|${config.authMode}|${config.token}`;
        if (!this.jira || this.jiraKey !== key) {
            const authHeaders = config.authMode === 'basic'
                ? { Authorization: basicAuthHeader(config.user, config.token) }
                : { Authorization: `Bearer ${config.token}` };
            this.jira = new JiraClient(http, this.getLogger(), config.baseUrl, authHeaders);
            this.jiraKey = key;
        }
        return this.jira;
    }

    private compilePattern(source: string): RegExp {
        let body = source.trim();
        let flags = '';
        const inline = body.match(/^\/([\s\S]*)\/([a-z]*)$/);
        if (inline) {
            body = inline[1];
            flags = inline[2];
        }
        if (!flags.includes('g')) {
            flags += 'g';
        }
        return new RegExp(body, flags);
    }

    private formatLink(key: string, summary: string, config: AppConfig): string {
        const cleaned = summary.replace(/\s+/g, ' ').trim();
        const abbreviated = cleaned.length <= config.abbrevLength
            ? cleaned
            : `${cleaned.slice(0, config.abbrevLength)}…`;
        return `[${key} (${abbreviated})](${config.baseUrl}/browse/${key})`;
    }

    private logError(context: string, err: any): void {
        const message = err && err.message ? err.message : String(err);
        this.getLogger().error(`[rocket-jira] ${context}: ${message}`);
    }
}
