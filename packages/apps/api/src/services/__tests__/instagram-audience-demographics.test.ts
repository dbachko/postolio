import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = {
  socialAccount: {
    findFirst: vi.fn(),
  },
} as any;

vi.mock('../../config/database.js', () => ({
  prisma: prismaMock,
  getDatabaseClient: vi.fn(() => prismaMock),
}));

const redisMock = {
  isConnected: vi.fn(() => false),
  get: vi.fn(),
  set: vi.fn(),
  increment: vi.fn(async () => 1),
};

vi.mock('../redis.js', () => ({
  redisService: redisMock,
}));

const credentialsMock = {
  accessToken: 'test-access-token',
  accountId: '17841405822304914',
  pageId: '1122334455',
};

const publisherCredentialsMock = {
  getCredentialsForBrand: vi.fn(async () => credentialsMock),
};

vi.mock('../publisher-credentials.js', () => ({
  PublisherCredentialsService: publisherCredentialsMock,
}));

const axiosGetMock = vi.fn();
vi.mock('axios', () => ({
  default: {
    get: axiosGetMock,
    post: vi.fn(),
  },
}));

const { instagramService } = await import('../instagram.js');

describe('instagramService.getAudienceDemographics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.socialAccount.findFirst.mockResolvedValue({ metadata: {} });
    publisherCredentialsMock.getCredentialsForBrand.mockResolvedValue(credentialsMock);
    redisMock.isConnected.mockReturnValue(false);
  });

  it('parses follower_demographics breakdowns into the expected shape', async () => {
    axiosGetMock.mockImplementation(async (url: string) => {
      if (url.includes('breakdowns=gender') || url.includes('breakdown=gender')) {
        return {
          data: {
            data: [
              {
                name: 'follower_demographics',
                total_value: {
                  breakdowns: [
                    {
                      dimension_keys: ['timeframe', 'gender'],
                      results: [
                        { dimension_values: ['THIS_MONTH', 'M'], value: 12 },
                        { dimension_values: ['THIS_MONTH', 'F'], value: 8 },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        };
      }
      if (url.includes('breakdowns=age') || url.includes('breakdown=age')) {
        return {
          data: {
            data: [
              {
                name: 'follower_demographics',
                total_value: {
                  breakdowns: [
                    {
                      dimension_keys: ['timeframe', 'age'],
                      results: [
                        { dimension_values: ['THIS_MONTH', '25-34'], value: 10 },
                        { dimension_values: ['THIS_MONTH', '18-24'], value: 6 },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        };
      }
      if (url.includes('breakdowns=country') || url.includes('breakdown=country')) {
        return {
          data: {
            data: [
              {
                name: 'follower_demographics',
                total_value: {
                  breakdowns: [
                    {
                      dimension_keys: ['timeframe', 'country'],
                      results: [
                        { dimension_values: ['THIS_MONTH', 'US'], value: 14 },
                        { dimension_values: ['THIS_MONTH', 'CA'], value: 4 },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        };
      }
      if (url.includes('breakdowns=city') || url.includes('breakdown=city')) {
        return {
          data: {
            data: [
              {
                name: 'follower_demographics',
                total_value: {
                  breakdowns: [
                    {
                      dimension_keys: ['timeframe', 'city'],
                      results: [
                        { dimension_values: ['THIS_MONTH', 'New York, NY'], value: 7 },
                        { dimension_values: ['THIS_MONTH', 'Toronto, ON'], value: 3 },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const res = await instagramService.getAudienceDemographics('brand-123');
    expect(res.status).toBe('available');
    expect(res.demographics?.gender).toEqual([
      { gender: 'M', value: 12 },
      { gender: 'F', value: 8 },
    ]);
    expect(res.demographics?.age).toEqual([
      { range: '25-34', value: 10 },
      { range: '18-24', value: 6 },
    ]);
    expect(res.demographics?.countries[0]).toEqual({ code: 'US', value: 14 });
    expect(res.demographics?.cities[0]).toEqual({ name: 'New York, NY', value: 7 });
    expect(res.demographics?.locales).toEqual([]);

    expect(axiosGetMock).toHaveBeenCalledTimes(4);
    for (const [url] of axiosGetMock.mock.calls) {
      expect(String(url)).toContain('metric=follower_demographics');
      expect(String(url)).toContain('period=lifetime');
      expect(String(url)).toContain('timeframe=this_month');
      expect(String(url)).toContain('metric_type=total_value');
    }
  });

  it('hides Graph API validation details for code 100 errors', async () => {
    axiosGetMock.mockRejectedValue({
      response: {
        data: {
          error: {
            message: '(#100) metric[0] must be one of the following values: follower_demographics',
            code: 100,
          },
        },
      },
    });

    const res = await instagramService.getAudienceDemographics('brand-123');
    expect(res.status).toBe('error');
    expect(res.errorMessage).toBeUndefined();
  });

  it('returns no_data when the account is below the follower threshold', async () => {
    axiosGetMock.mockRejectedValue({
      response: {
        data: {
          error: {
            message: 'Not returned if the IG User has less than 100 followers.',
            code: 100,
          },
        },
      },
    });

    const res = await instagramService.getAudienceDemographics('brand-123');
    expect(res.status).toBe('no_data');
    expect(res.errorMessage).toBeUndefined();
  });
});
