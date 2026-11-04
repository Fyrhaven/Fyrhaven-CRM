// @vitest-environment jsdom
// The avatar element: what it renders, and what it does when the image fails.
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeAvatar } from '../src/lib/avatar-view.js';

afterEach(cleanup);

const Avatar = makeAvatar(React);

const draw = (props) => {
  let result;
  act(() => { result = render(React.createElement(Avatar, props)); });
  return result;
};

describe('the avatar element', () => {
  it('renders the image with the source it was given', () => {
    draw({ avatar: { url: 'https://x/me.jpg', source: 'card' }, size: 48 });

    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://x/me.jpg');
    expect(img.getAttribute('data-avatar')).toBe('card');
    expect(img.getAttribute('width')).toBe('48');
  });

  it('draws nothing at all when there is no avatar', () => {
    draw({ avatar: null });

    expect(document.querySelector('img')).toBeNull();
  });

  it('is lazy and sends no referrer', () => {
    draw({ avatar: { url: 'https://x/me.jpg', source: 'gravatar' } });

    const img = document.querySelector('img');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    // decorative: the name is right beside it
    expect(img.getAttribute('alt')).toBe('');
  });

  it('disappears when the image fails to load', () => {
    // a blocked request, an offline browser and "this contact has no picture"
    // are indistinguishable from here, and all three must end as nothing
    draw({ avatar: { url: 'https://www.gravatar.com/avatar/deadbeef?d=404', source: 'gravatar' } });
    expect(document.querySelector('img')).toBeTruthy();

    act(() => { fireEvent.error(document.querySelector('img')); });

    expect(document.querySelector('img')).toBeNull();
  });

  it('ignores a later failure of a different image', () => {
    const first = draw({ avatar: { url: 'https://x/one.jpg', source: 'card' } });
    act(() => { fireEvent.error(document.querySelector('img')); });
    expect(document.querySelector('img')).toBeNull();

    first.unmount();
    draw({ avatar: { url: 'https://x/two.jpg', source: 'card' } });
    expect(document.querySelector('img')).toBeTruthy();
  });
});
