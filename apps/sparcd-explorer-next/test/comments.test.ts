import { describe, expect, it } from 'vitest';
import { commentText } from '../src/data';
import { collection, deployment, media, modelOf, observation } from './support/fixtures';

describe('comments on a photo', () => {
  it('drop the tools’ markers and keep what people wrote', () => {
    expect(commentText('[COMMONNAME:Bobcat][REVIEWED_BY:someone] two cats at the water')).toBe('two cats at the water');
    expect(commentText('[TIMESTAMP:manual]')).toBe('');
    expect(commentText(undefined)).toBe('');
  });

  it('join the photo’s own comment and its tags’ comments once each', () => {
    const model = modelOf(
      collection().upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [{ ...media('u1', 'a.jpg', 'AA01', '2024-01-01T10:00:00'), comments: '[TIMESTAMP:manual] lens fogged' }],
        observations: [
          observation('u1', 'a.jpg', 'AA01', '', { common: 'Bobcat', scientific: 'Lynx rufus', tags: ' kitten behind' }),
          observation('u1', 'a.jpg', 'AA01', '', { common: 'Deer', scientific: 'Odocoileus hemionus', tags: ' kitten behind' }),
        ],
      }),
    );
    expect(model.photos[0].comments).toBe('lens fogged · kitten behind');
  });
});
