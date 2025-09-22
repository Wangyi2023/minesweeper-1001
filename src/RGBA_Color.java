public class RGBA_Color {
    public int r, g, b;
    public double a;

    public RGBA_Color(int r, int g, int b, double a) {
        if (r < 0 || g < 0 || b < 0 || a < 0 ||
                r > 255 || g > 255 || b > 255 || a > 1)
            throw new IllegalArgumentException();
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }
    public RGBA_Color(String rgb, double a) {
        this(
                Integer.parseInt(rgb.substring(0, 2), 16),
                Integer.parseInt(rgb.substring(2, 4), 16),
                Integer.parseInt(rgb.substring(4, 6), 16),
                a
        );
    }
    public RGBA_Color(String rgb) {
        this(rgb, 1.0);
    }
    public RGBA_Color(int rgb, double a) {
        this(String.format("%06X", rgb), a);
    }
    public RGBA_Color(int rgb) {
        this(rgb, 1.0);
    }

    public RGBA_Color blend(RGBA_Color foreground) {
        double a_ = foreground.a + this.a * (1 - foreground.a);

        int r_ = 0, g_ = 0, b_ = 0;
        if (a_ > 0) {
            r_ = (int) Math.round((foreground.r * foreground.a + this.r * this.a * (1 - foreground.a)) / a_);
            g_ = (int) Math.round((foreground.g * foreground.a + this.g * this.a * (1 - foreground.a)) / a_);
            b_ = (int) Math.round((foreground.b * foreground.a + this.b * this.a * (1 - foreground.a)) / a_);
        }

        r_ = Math.min(255, Math.max(0, r_));
        g_ = Math.min(255, Math.max(0, g_));
        b_ = Math.min(255, Math.max(0, b_));

        return new RGBA_Color(r_, g_, b_, a_);
    }

    @Override
    public String toString() {
        return "(" + r + "," + g + "," + b + "," + a + ")";
    }

    public static void main(String[] args) {
        System.out.println("RGBA-Color blending calculation");

        RGBA_Color background = new RGBA_Color(255, 0, 0, 0.2);
        RGBA_Color foreground = new RGBA_Color(255, 0, 0, 0.9);

        RGBA_Color result = background.blend(foreground);

        System.out.println("Background: " + background.toString());
        System.out.println("Foreground: " + foreground.toString());
        System.out.println("Result: " + result.toString());
    }
}

