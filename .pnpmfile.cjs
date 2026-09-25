module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "next" && pkg.dependencies?.postcss) {
        pkg.dependencies.postcss = "8.5.23"
      }
      return pkg
    },
  },
}
