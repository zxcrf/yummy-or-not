// Custom pages-router error page for the headless API.
//
// This app is App Router only, but Next still emits a legacy pages/_error and
// statically prerenders /404 + /500 from it. On Next 15.5.19 that default page
// crashes during prerender ("Cannot read properties of null (reading
// 'useContext')"), which fails the whole build. Providing our own minimal,
// hook-free error component (with getInitialProps, so it is not statically
// optimized the broken way) overrides the default and lets the build complete.
// A headless JSON API serves no real HTML, so this is intentionally plain.
import type { NextPageContext } from 'next';

function Error({ statusCode }: { statusCode: number }) {
  return (
    <main>
      <h1>{statusCode || 'Error'}</h1>
      <p>This host serves the Yummy or Not JSON API under /api.</p>
    </main>
  );
}

Error.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};

export default Error;
