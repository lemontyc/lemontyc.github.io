# The local preview environment. Pinned to the versions GitHub Pages runs,
# so what you see at localhost:4000 is what ends up on lemontyc.com.
FROM ruby:3.3

RUN gem install jekyll -v 3.10.0 -N --no-document \
 && gem install jekyll-feed jekyll-sitemap kramdown-parser-gfm webrick -N --no-document

# The site's own Gemfile is for GitHub Pages; the gems above are already here.
ENV JEKYLL_NO_BUNDLER_REQUIRE=true

WORKDIR /site
EXPOSE 4000 35729
