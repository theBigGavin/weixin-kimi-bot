/**
 * Message Utils 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFounderPrompt, showTyping } from '../../src/handlers/message-utils.js';
import type { AgentConfig } from '../../src/agent/types.js';
import type { ApiOptions } from '../../src/ilink/api.js';

// Mock ilink/api module
vi.mock('../../src/ilink/api.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ilink/api.js')>('../../src/ilink/api.js');
  return {
    ...actual,
    getConfig: vi.fn(),
    sendTyping: vi.fn(),
  };
});

import { getConfig, sendTyping } from '../../src/ilink/api.js';

describe('buildFounderPrompt', () => {
  it('should return empty string when no projectSpace', () => {
    const config = {
      workspace: { path: '/workspace' },
    } as AgentConfig;

    const result = buildFounderPrompt(config);
    expect(result).toBe('');
  });

  it('should return prompt with project info', () => {
    const config = {
      projectSpace: {
        path: '/project/myapp',
        description: 'My Application',
      },
      workspace: { path: '/workspace' },
    } as AgentConfig;

    const result = buildFounderPrompt(config);
    
    expect(result).toContain('## 项目维护规范 (ProjectSpace)');
    expect(result).toContain('你当前正在维护项目：My Application');
    expect(result).toContain('项目路径：/project/myapp');
    expect(result).toContain('./project/ → 软链接到 /project/myapp');
    expect(result).toContain('./workspace/ → 软链接到 /workspace');
  });

  it('should include repository if provided', () => {
    const config = {
      projectSpace: {
        path: '/project/myapp',
        description: 'My Application',
        repository: 'https://github.com/user/repo',
      },
      workspace: { path: '/workspace' },
    } as AgentConfig;

    const result = buildFounderPrompt(config);
    
    expect(result).toContain('代码仓库：https://github.com/user/repo');
  });

  it('should use default project name when description is missing', () => {
    const config = {
      projectSpace: {
        path: '/project/myapp',
      },
      workspace: { path: '/workspace' },
    } as AgentConfig;

    const result = buildFounderPrompt(config);
    
    expect(result).toContain('你当前正在维护项目：当前项目');
  });

  it('should include PARA organization section', () => {
    const config = {
      projectSpace: {
        path: '/project/myapp',
        description: 'My App',
      },
      workspace: { path: '/workspace' },
    } as AgentConfig;

    const result = buildFounderPrompt(config);
    
    expect(result).toContain('**3. PARA 整理 (每周执行)**');
    expect(result).toContain('- Projects/ - 进行中的项目');
    expect(result).toContain('- Areas/ - 持续维护的职责领域');
    expect(result).toContain('- Resources/ - 参考资料、学习笔记');
    expect(result).toContain('- Archives/ - 已完成或暂停的项目');
  });

  it('should include development workflow checklist', () => {
    const config = {
      projectSpace: {
        path: '/project/myapp',
        description: 'My App',
      },
      workspace: { path: '/workspace' },
    } as AgentConfig;

    const result = buildFounderPrompt(config);
    
    expect(result).toContain('**2. 开发流程 (必须遵循)**');
    expect(result).toContain('进入 ./project/ 目录');
    expect(result).toContain('git status 确认无未提交变更');
    expect(result).toContain('npm run deploy:patch');
  });

  it('should include CI/CD section', () => {
    const config = {
      projectSpace: {
        path: '/project/myapp',
        description: 'My App',
      },
      workspace: { path: '/workspace' },
    } as AgentConfig;

    const result = buildFounderPrompt(config);
    
    expect(result).toContain('**4. CI/CD 利用**');
    expect(result).toContain('GitHub Actions');
  });

  it('should sanitize project name for directory path', () => {
    const config = {
      projectSpace: {
        path: '/project/my app',
        description: 'My Application Project',
      },
      workspace: { path: '/workspace' },
    } as AgentConfig;

    const result = buildFounderPrompt(config);
    
    // Project name with spaces should be converted to underscores in path
    expect(result).toContain('Projects/My_Application_Project/');
  });
});

describe('showTyping', () => {
  const mockApi: ApiOptions = {
    baseUrl: 'https://test.com',
    token: 'test-token',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send typing status when typing_ticket exists', async () => {
    vi.mocked(getConfig).mockResolvedValue({
      typing_ticket: 'ticket-123',
    } as any);
    vi.mocked(sendTyping).mockResolvedValue(undefined);

    await showTyping(mockApi, 'user123', 'ctx-token');

    expect(getConfig).toHaveBeenCalledWith(mockApi, 'user123', 'ctx-token');
    expect(sendTyping).toHaveBeenCalledWith(mockApi, {
      ilink_user_id: 'user123',
      typing_ticket: 'ticket-123',
      status: 1, // TypingStatus.TYPING
    });
  });

  it('should not send typing status when typing_ticket is missing', async () => {
    vi.mocked(getConfig).mockResolvedValue({
      typing_ticket: undefined,
    } as any);

    await showTyping(mockApi, 'user123', 'ctx-token');

    expect(getConfig).toHaveBeenCalledWith(mockApi, 'user123', 'ctx-token');
    expect(sendTyping).not.toHaveBeenCalled();
  });

  it('should handle errors silently', async () => {
    vi.mocked(getConfig).mockRejectedValue(new Error('Network error'));

    // Should not throw
    await expect(showTyping(mockApi, 'user123', 'ctx-token')).resolves.toBeUndefined();
    
    expect(sendTyping).not.toHaveBeenCalled();
  });

  it('should work without contextToken', async () => {
    vi.mocked(getConfig).mockResolvedValue({
      typing_ticket: 'ticket-456',
    } as any);
    vi.mocked(sendTyping).mockResolvedValue(undefined);

    await showTyping(mockApi, 'user456');

    expect(getConfig).toHaveBeenCalledWith(mockApi, 'user456', undefined);
    expect(sendTyping).toHaveBeenCalledWith(mockApi, {
      ilink_user_id: 'user456',
      typing_ticket: 'ticket-456',
      status: 1,
    });
  });
});
