const { sanitizeResultsForReporter } = require('../../src/utils/sanitize-results');

describe('sanitizeResultsForReporter', () => {
  it('redacts copied AWS secret values in reporter output', () => {
    const results = [{
      request: { headers: { Authorization: 'Bearer copied-secret' }, data: 'body=copied-secret' },
      response: { headers: {}, data: { echoed: 'copied-secret' } }
    }];

    sanitizeResultsForReporter(results, {
      redactor: (value) => JSON.parse(JSON.stringify(value).replaceAll('copied-secret', '[AWS_SECRET_REDACTED]'))
    });

    expect(results[0]).toEqual({
      request: { headers: { Authorization: 'Bearer [AWS_SECRET_REDACTED]' }, data: 'body=[AWS_SECRET_REDACTED]' },
      response: { headers: {}, data: { echoed: '[AWS_SECRET_REDACTED]' } }
    });
  });
});
