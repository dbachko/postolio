import type { ComponentPropsWithoutRef } from 'react';
import { siFacebook, siInstagram, siTiktok, siX, siYoutube } from 'simple-icons';

type SvgProps = Omit<ComponentPropsWithoutRef<'svg'>, 'children'>;

type SimpleIconProps = SvgProps & {
  title?: string;
  path: string;
};

function SimpleIcon({ title, path, ...props }: SimpleIconProps) {
  const ariaHidden = title ? undefined : true;

  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-hidden={ariaHidden}
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d={path} fill="currentColor" />
    </svg>
  );
}

export type BrandIconProps = SvgProps & {
  title?: string;
};

// Source: https://github.com/simple-icons/simple-icons
export function FacebookIcon({ title, ...props }: BrandIconProps) {
  return <SimpleIcon title={title ?? siFacebook.title} path={siFacebook.path} {...props} />;
}

export function InstagramIcon({ title, ...props }: BrandIconProps) {
  return <SimpleIcon title={title ?? siInstagram.title} path={siInstagram.path} {...props} />;
}

export function YouTubeIcon({ title, ...props }: BrandIconProps) {
  return <SimpleIcon title={title ?? siYoutube.title} path={siYoutube.path} {...props} />;
}

export function XBrandIcon({ title, ...props }: BrandIconProps) {
  return <SimpleIcon title={title ?? siX.title} path={siX.path} {...props} />;
}

export function TikTokIcon({ title, ...props }: BrandIconProps) {
  return <SimpleIcon title={title ?? siTiktok.title} path={siTiktok.path} {...props} />;
}
