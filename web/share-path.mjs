export const previewIdFrom = path => /^\/share\/([a-f0-9]{32})$/.exec(path)?.[1];
export const isSharedCardPath = path => path === "/share" || Boolean(previewIdFrom(path));
