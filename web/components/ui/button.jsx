export function Button({ variant = "default", size, danger, type = "button", className, ...props }) {
  const classes = ["paper-button", "paper-button--" + variant,
    size === "small" && "paper-button--small", danger && "paper-button--danger", className];
  return <button type={type} className={classes.filter(Boolean).join(" ")} {...props} />;
}
